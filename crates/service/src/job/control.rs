//! Taskmill 调度器与任务生命周期控制（暂停队列、取消、历史清理等）。

use anyhow::{Context, bail};
use serde::Serialize;
use taskmill::{
    HistoryStatus, PauseReasons, SubmitOutcome, TaskHistoryRecord, TaskRecord, TaskStatus,
    TypedTask,
};
use utoipa::ToSchema;

use super::storage::TaskmillRuntime;
use super::types::{
    FfmpegSetupDownloadTask, MediaLibraryScanTask, SubtitleTranslateJob,
    VideoSubtitleExtractWavTask, VideoSubtitleGenerateTask, VideoSubtitleRecognizeTask,
    WhisperModelDownloadTask,
};

/// 通用成功响应。
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TaskmillControlOk {
    pub ok: bool,
}

/// 取消任务结果。
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TaskmillCancelRes {
    pub cancelled: bool,
}

/// 删除历史记录结果。
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TaskmillDeleteHistoryRes {
    pub deleted: bool,
}

/// 重新执行历史任务的结果。
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TaskmillRerunHistoryRes {
    pub submitted: bool,
    pub task_id: Option<i64>,
}

impl TaskmillRuntime {
    /// 全局暂停调度器：停止派发，运行中任务进入 paused。
    pub async fn pause_scheduler(&self) {
        self.scheduler.pause_all().await;
    }

    /// 全局恢复调度器。
    pub async fn resume_scheduler(&self) {
        self.scheduler.resume_all().await;
    }

    /// 取消指定任务（运行中 / 等待 / pending 等）。
    pub async fn cancel_task(&self, task_id: i64) -> anyhow::Result<bool> {
        self.scheduler.cancel(task_id).await.context("取消任务失败")
    }

    /// 暂停 pending / blocked 任务；运行中任务应使用取消。
    pub async fn pause_task(&self, task_id: i64) -> anyhow::Result<()> {
        let store = self.scheduler.store();
        let task = store
            .task_by_id(task_id)
            .await
            .context("查询任务失败")?
            .ok_or_else(|| anyhow::anyhow!("任务不存在或已结束"))?;

        match task.status {
            TaskStatus::Pending | TaskStatus::Blocked => {
                store
                    .pause(task_id, PauseReasons::PREEMPTION)
                    .await
                    .context("暂停任务失败")?;
                Ok(())
            }
            TaskStatus::Paused => Ok(()),
            TaskStatus::Running | TaskStatus::Waiting => {
                bail!("运行中或等待子任务的任务请使用取消，无法单独暂停")
            }
        }
    }

    /// 将 paused 任务恢复为 pending。
    pub async fn resume_task(&self, task_id: i64) -> anyhow::Result<()> {
        let store = self.scheduler.store();
        let task = store
            .task_by_id(task_id)
            .await
            .context("查询任务失败")?
            .ok_or_else(|| anyhow::anyhow!("任务不存在或已结束"))?;

        if task.status != TaskStatus::Paused {
            bail!("仅 paused 状态的任务可恢复，当前状态为 {:?}", task.status);
        }

        store.resume(task_id).await.context("恢复任务失败")?;
        Ok(())
    }

    /// 删除一条任务历史记录。
    pub async fn delete_history(&self, history_id: i64) -> anyhow::Result<bool> {
        self.scheduler
            .store()
            .delete_history(history_id)
            .await
            .context("删除历史记录失败")
    }

    /// 重新提交一条失败类历史任务。
    pub async fn rerun_history(&self, history_id: i64) -> anyhow::Result<TaskmillRerunHistoryRes> {
        let history = self
            .scheduler
            .store()
            .history_by_id(history_id)
            .await
            .context("读取历史任务失败")?
            .ok_or_else(|| anyhow::anyhow!("历史任务不存在"))?;

        if !is_rerunnable_history_status(history.status) {
            bail!("仅失败、死信、依赖失败或过期的历史任务可重新执行");
        }

        let outcome = self.submit_history_payload(&history).await?;
        let task_id = outcome.id();
        Ok(TaskmillRerunHistoryRes {
            submitted: outcome.is_inserted() || task_id.is_some(),
            task_id,
        })
    }

    async fn submit_history_payload(
        &self,
        history: &TaskHistoryRecord,
    ) -> anyhow::Result<SubmitOutcome> {
        let payload = history
            .payload
            .as_deref()
            .ok_or_else(|| anyhow::anyhow!("历史任务缺少 payload，无法重新执行"))?;

        match strip_domain_prefix(&history.task_type) {
            VideoSubtitleGenerateTask::TASK_TYPE => {
                self.enqueue_generate(parse_history_payload::<VideoSubtitleGenerateTask>(payload)?)
                    .await
            }
            VideoSubtitleExtractWavTask::TASK_TYPE => {
                let task = parse_history_payload::<VideoSubtitleExtractWavTask>(payload)?;
                self.enqueue_generate(VideoSubtitleGenerateTask {
                    video_path: task.video_path,
                    config: task.config,
                })
                .await
            }
            VideoSubtitleRecognizeTask::TASK_TYPE => {
                let task = parse_history_payload::<VideoSubtitleRecognizeTask>(payload)?;
                self.enqueue_generate(VideoSubtitleGenerateTask {
                    video_path: task.video_path,
                    config: task.config,
                })
                .await
            }
            SubtitleTranslateJob::TASK_TYPE => {
                self.enqueue_translate(parse_history_payload::<SubtitleTranslateJob>(payload)?)
                    .await
            }
            MediaLibraryScanTask::TASK_TYPE => {
                self.enqueue_media_library_scan(parse_history_payload::<MediaLibraryScanTask>(
                    payload,
                )?)
                .await
            }
            WhisperModelDownloadTask::TASK_TYPE => {
                self.enqueue_whisper_model_download(parse_history_payload::<
                    WhisperModelDownloadTask,
                >(payload)?)
                    .await
            }
            FfmpegSetupDownloadTask::TASK_TYPE => {
                let _ = parse_history_payload::<FfmpegSetupDownloadTask>(payload)?;
                self.enqueue_ffmpeg_setup_download(FfmpegSetupDownloadTask)
                    .await
            }
            other => bail!("不支持重新执行的任务类型: {other}"),
        }
    }

    /// 列出活跃队列中的任务（pending / running / paused / waiting / blocked）。
    pub async fn list_active_tasks(&self, limit: i32) -> anyhow::Result<Vec<TaskRecord>> {
        let limit = limit.clamp(1, 500) as usize;
        let mut tasks = self
            .scheduler
            .store()
            .all_active_tasks()
            .await
            .context("读取活跃任务失败")?;
        tasks.truncate(limit);
        Ok(tasks)
    }
}

fn is_rerunnable_history_status(status: HistoryStatus) -> bool {
    matches!(
        status,
        HistoryStatus::Failed
            | HistoryStatus::DeadLetter
            | HistoryStatus::DependencyFailed
            | HistoryStatus::Expired
    )
}

fn strip_domain_prefix(task_type: &str) -> &str {
    task_type
        .rsplit_once("::")
        .map(|(_, ty)| ty)
        .unwrap_or(task_type)
}

fn parse_history_payload<T>(payload: &[u8]) -> anyhow::Result<T>
where
    T: serde::de::DeserializeOwned,
{
    serde_json::from_slice(payload).context("解析历史任务 payload 失败")
}
