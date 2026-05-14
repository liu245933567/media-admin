//! 启动 Taskmill scheduler，并定义演示任务 executor。

use taskmill::{DomainTaskContext, TaskError, TypedExecutor};

use super::storage::TaskmillDemo;
use super::translate_only;
use super::types::{TaskmillDemoDomain, TranslateSubtitleOnlyInput, VideoSubtitlePipelineInput};
use super::video_pipeline;

pub struct VideoPipelineExecutor;

impl TypedExecutor<VideoSubtitlePipelineInput> for VideoPipelineExecutor {
    async fn execute(
        &self,
        job: VideoSubtitlePipelineInput,
        ctx: DomainTaskContext<'_, TaskmillDemoDomain>,
    ) -> Result<(), TaskError> {
        ctx.progress().report(0.1, Some("开始视频流水线".into()));
        ctx.check_cancelled()?;

        let a = video_pipeline::step_extract_wav(job).await?;
        ctx.record_read_bytes(8 * 1024 * 1024);
        ctx.record_write_bytes(2 * 1024 * 1024);
        ctx.progress().report(0.35, Some("已提取 WAV".into()));
        ctx.check_cancelled()?;

        let b = video_pipeline::step_whisper_vad(a).await?;
        ctx.record_read_bytes(2 * 1024 * 1024);
        ctx.record_write_bytes(1024 * 1024);
        ctx.progress().report(0.7, Some("已生成字幕".into()));
        ctx.check_cancelled()?;

        let _ = video_pipeline::step_translate_subtitle(b).await?;
        ctx.record_read_bytes(512 * 1024);
        ctx.record_write_bytes(512 * 1024);
        ctx.progress().report(1.0, Some("视频流水线完成".into()));
        Ok(())
    }
}

pub struct TranslateOnlyExecutor;

impl TypedExecutor<TranslateSubtitleOnlyInput> for TranslateOnlyExecutor {
    async fn execute(
        &self,
        job: TranslateSubtitleOnlyInput,
        ctx: DomainTaskContext<'_, TaskmillDemoDomain>,
    ) -> Result<(), TaskError> {
        ctx.progress().report(0.2, Some("开始翻译字幕".into()));
        ctx.check_cancelled()?;

        translate_only::step_translate_only(job).await?;
        ctx.record_read_bytes(256 * 1024);
        ctx.record_write_bytes(256 * 1024);
        ctx.progress().report(1.0, Some("字幕翻译完成".into()));
        Ok(())
    }
}

/// 在后台运行 Taskmill scheduler；`TaskmillDemo` 需已 [`TaskmillDemo::setup`](super::storage::TaskmillDemo::setup)。
pub fn spawn_taskmill_demo_scheduler(demo: &TaskmillDemo) {
    let scheduler = demo.scheduler.clone();
    let cancellation = demo.cancellation.clone();

    tokio::spawn(async move {
        scheduler.run(cancellation).await;
        tracing::info!("taskmill demo scheduler stopped");
    });
}
