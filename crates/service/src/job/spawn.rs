//! Taskmill 调度器启动与任务 executor。

use std::path::Path;

use ma_subtitle::pipeline::generate_subtitle_pipeline;
use ma_subtitle::translate::translate_srt_file;
use ma_whisper::engine_cache::spawn_idle_eviction_loop;
use taskmill::{DomainTaskContext, TaskError, TypedExecutor};

use super::storage::{MediaLibraryScanDeps, TaskmillRuntime};
use super::types::{
    MediaJobsDomain, MediaLibraryScanTask, SubtitleTranslateJob, VideoSubtitleGenerateTask,
};

pub struct VideoSubtitleGenerateExecutor;

impl TypedExecutor<VideoSubtitleGenerateTask> for VideoSubtitleGenerateExecutor {
    async fn execute(
        &self,
        job: VideoSubtitleGenerateTask,
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        let video_path = job.video_path.trim();
        if video_path.is_empty() {
            return Err(TaskError::permanent("video_path 不能为空"));
        }

        ctx.progress()
            .report(0.05, Some(format!("开始字幕流水线: {video_path}")));
        ctx.check_cancelled()?;

        let path = Path::new(video_path);
        let config = job.config.clone();

        let outcome = generate_subtitle_pipeline(path, &config)
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;

        let srt_hint = outcome
            .items
            .first()
            .map(|i| i.srt_path.as_str())
            .unwrap_or("");
        ctx.progress()
            .report(0.9, Some(format!("已生成源字幕: {srt_hint}")));
        ctx.check_cancelled()?;

        if let Some(pending) = outcome.pending_translate {
            ctx.domain::<MediaJobsDomain>()
                .submit(SubtitleTranslateJob {
                    source_srt_path: pending.source_srt_path.clone(),
                    config: pending.config,
                })
                .await
                .map_err(|e| TaskError::retryable(format!("入队翻译任务失败: {e:#}")))?;
            ctx.progress().report(
                0.95,
                Some(format!("已入队翻译任务（独立调度）: {}", pending.source_srt_path)),
            );
        }

        ctx.progress().report(1.0, Some("字幕生成完成".into()));
        Ok(())
    }
}

pub struct SubtitleTranslateExecutor;

impl TypedExecutor<SubtitleTranslateJob> for SubtitleTranslateExecutor {
    async fn execute(
        &self,
        job: SubtitleTranslateJob,
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        let src = Path::new(job.source_srt_path.trim());
        if job.source_srt_path.trim().is_empty() {
            return Err(TaskError::permanent("source_srt_path 不能为空"));
        }

        ctx.progress().report(
            0.1,
            Some(format!("开始翻译 -> {}", job.config.target_language)),
        );
        ctx.check_cancelled()?;

        let out = translate_srt_file(src, None, &job.config)
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;

        ctx.progress()
            .report(1.0, Some(format!("翻译完成: {}", out.display())));
        Ok(())
    }
}

/// 媒体库扫描任务 executor。
#[derive(Clone)]
pub struct MediaLibraryScanExecutor {
    deps: MediaLibraryScanDeps,
}

impl MediaLibraryScanExecutor {
    /// 创建媒体库扫描 executor。
    pub fn new(deps: MediaLibraryScanDeps) -> Self {
        Self { deps }
    }
}

impl TypedExecutor<MediaLibraryScanTask> for MediaLibraryScanExecutor {
    async fn execute(
        &self,
        job: MediaLibraryScanTask,
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        let root_id = i64::from(job.root_id);
        if root_id <= 0 {
            return Err(TaskError::permanent("root_id 必须大于 0"));
        }
        if job.root_path.trim().is_empty() {
            return Err(TaskError::permanent("root_path 不能为空"));
        }

        ctx.progress()
            .report(0.05, Some(format!("开始扫描媒体资源: {}", job.root_path)));
        ctx.check_cancelled()?;

        let res = crate::media_library::scan_media_root(&self.deps.db, root_id, &job.root_path)
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;

        ctx.progress().report(
            1.0,
            Some(format!(
                "扫描完成：{} 个文件（视频 {}，字幕 {}），移除 {} 条旧记录",
                res.scanned, res.videos, res.subtitles, res.removed
            )),
        );
        Ok(())
    }
}

/// 在后台运行 Taskmill scheduler。
pub fn spawn_taskmill_scheduler(runtime: &TaskmillRuntime) {
    let scheduler = runtime.scheduler.clone();
    let cancellation = runtime.cancellation.clone();

    spawn_idle_eviction_loop(cancellation.clone());

    tokio::spawn(async move {
        scheduler.run(cancellation).await;
        tracing::info!("taskmill scheduler stopped");
    });
}
