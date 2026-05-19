//! Taskmill 调度器启动与任务 executor。

use std::path::Path;

use ma_subtitle::{generate::write_srt_from_recognize, translate::translate_srt_file};
use ma_whisper::{generate::recognize_wav_voice, wav::extract_wav_16k_mono};
use taskmill::{DomainTaskContext, TaskError, TypedExecutor};

use super::storage::TaskmillRuntime;
use super::types::{
    ExtractWavTask, MediaJobsDomain, SubtitleTranslateJob, VideoSubtitleGenerateTask,
    WhisperVadSrtTask,
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
            .report(0.05, Some(format!("入队提取 WAV: {video_path}")));
        ctx.check_cancelled()?;

        ctx.spawn_child_with(ExtractWavTask::from_video_config(
            job.video_path.clone(),
            &job.config,
        ))
            .await
            .map_err(|e| TaskError::retryable(format!("入队提取 WAV 失败: {e}")))?;

        ctx.progress().report(0.08, Some("已入队提取 WAV".into()));
        Ok(())
    }
}

pub struct ExtractWavExecutor;

impl TypedExecutor<ExtractWavTask> for ExtractWavExecutor {
    async fn execute(
        &self,
        job: ExtractWavTask,
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        let video_path = job.video_path.trim();
        if video_path.is_empty() {
            return Err(TaskError::permanent("video_path 不能为空"));
        }

        ctx.progress()
            .report(0.1, Some(format!("开始提取 WAV: {video_path}")));
        ctx.check_cancelled()?;

        let wav_path = extract_wav_16k_mono(Path::new(video_path))
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;

        ctx.progress()
            .report(0.4, Some(format!("已提取 WAV: {}", wav_path.display())));
        ctx.check_cancelled()?;

        ctx.spawn_child_with(WhisperVadSrtTask {
            video_path: job.video_path,
            wav_path: wav_path.display().to_string(),
            vad_config: job.vad_config,
            whisper_engine_config: job.whisper_engine_config,
            whisper_transcribe_config: job.whisper_transcribe_config,
            translate_config: job.translate_config,
        })
        .await
        .map_err(|e| TaskError::retryable(format!("入队识别字幕失败: {e}")))?;

        ctx.progress()
            .report(0.45, Some("已入队 VAD+Whisper".into()));
        Ok(())
    }
}

pub struct WhisperVadSrtExecutor;

impl TypedExecutor<WhisperVadSrtTask> for WhisperVadSrtExecutor {
    async fn execute(
        &self,
        job: WhisperVadSrtTask,
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        let video_path = job.video_path.trim();
        let wav_path = job.wav_path.trim();
        if video_path.is_empty() {
            return Err(TaskError::permanent("video_path 不能为空"));
        }
        if wav_path.is_empty() {
            return Err(TaskError::permanent("wav_path 不能为空"));
        }

        ctx.progress()
            .report(0.5, Some(format!("开始 VAD+Whisper: {video_path}")));
        ctx.check_cancelled()?;

        let recognize_result = recognize_wav_voice(
            Path::new(wav_path),
            job.vad_config,
            job.whisper_engine_config,
            job.whisper_transcribe_config,
        )
        .map_err(|e| TaskError::retryable(format!("{e:#}")))?;

        ctx.progress().report(0.8, Some("正在写入 SRT".into()));
        ctx.check_cancelled()?;

        let outcome = write_srt_from_recognize(
            &job.video_path,
            recognize_result,
            job.translate_config.as_ref(),
        )
        .await
        .map_err(|e| TaskError::retryable(format!("{e:#}")))?;

        let srt_hint = outcome
            .items
            .first()
            .map(|i| i.srt_path.as_str())
            .unwrap_or("");
        ctx.progress()
            .report(0.88, Some(format!("已生成字幕: {srt_hint}")));
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

        ctx.progress().report(1.0, Some("字幕识别完成".into()));
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

/// 在后台运行 Taskmill scheduler。
pub fn spawn_taskmill_scheduler(runtime: &TaskmillRuntime) {
    let scheduler = runtime.scheduler.clone();
    let cancellation = runtime.cancellation.clone();

    tokio::spawn(async move {
        scheduler.run(cancellation).await;
        tracing::info!("taskmill scheduler stopped");
    });
}
