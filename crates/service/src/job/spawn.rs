//! Taskmill 调度器启动与任务 executor。

use std::path::Path;

use ma_subtitle::{generate::generate_subtitle_by_video, translate::translate_srt_file};
use taskmill::{DomainTaskContext, TaskError, TypedExecutor};

use super::storage::TaskmillRuntime;
use super::types::{MediaJobsDomain, SubtitleTranslateJob, VideoSubtitleGenerateTask};

pub struct VideoSubtitleGenerateExecutor;

impl TypedExecutor<VideoSubtitleGenerateTask> for VideoSubtitleGenerateExecutor {
    async fn execute(
        &self,
        job: VideoSubtitleGenerateTask,
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        let config = &job.0;
        let video_path = config.video_path.trim().to_string();
        if video_path.is_empty() {
            return Err(TaskError::permanent("video_path 不能为空"));
        }

        ctx.progress()
            .report(0.05, Some(format!("开始识别: {video_path}")));
        ctx.check_cancelled()?;

        let outcome = generate_subtitle_by_video(config)
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;

        let srt_hint = outcome
            .items
            .first()
            .map(|i| i.srt_path.as_str())
            .unwrap_or("");
        ctx.progress()
            .report(0.85, Some(format!("已生成字幕: {srt_hint}")));
        ctx.check_cancelled()?;

        if let Some(pending) = outcome.pending_translate {
            ctx.spawn_child_with(SubtitleTranslateJob {
                source_srt_path: pending.source_srt_path,
                config: pending.config,
            })
            .await
            .map_err(|e| TaskError::retryable(format!("入队翻译任务失败: {e}")))?;
            ctx.progress().report(0.92, Some("已入队字幕翻译".into()));
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
            Some(format!(
                "开始翻译 -> {}",
                job.config.target_language
            )),
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

/// 在后台运行 Taskmill scheduler。
pub fn spawn_taskmill_scheduler(runtime: &TaskmillRuntime) {
    let scheduler = runtime.scheduler.clone();
    let cancellation = runtime.cancellation.clone();

    tokio::spawn(async move {
        scheduler.run(cancellation).await;
        tracing::info!("taskmill scheduler stopped");
    });
}
