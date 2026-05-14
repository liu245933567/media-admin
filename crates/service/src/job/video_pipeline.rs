//! 视频 → wav → Whisper+VAD 字幕 → 翻译字幕（占位步骤）。

use std::time::Duration;

use taskmill::TaskError;
use tokio::time::sleep;

use super::types::{AfterExtractWav, AfterTranscribe, AfterTranslate, VideoSubtitlePipelineInput};

/// Taskmill 任务类型名。
pub const VIDEO_PIPELINE_QUEUE: &str = "demo-video-pipeline";

pub(crate) async fn step_extract_wav(
    input: VideoSubtitlePipelineInput,
) -> Result<AfterExtractWav, TaskError> {
    tracing::info!(
        video = %input.video_path,
        "[taskmill-demo] 占位: 从视频提取 WAV"
    );
    sleep(Duration::from_secs(2)).await;
    Ok(AfterExtractWav {
        video_path: input.video_path.clone(),
        wav_path: format!("{}.demo.wav", input.video_path),
    })
}

pub(crate) async fn step_whisper_vad(input: AfterExtractWav) -> Result<AfterTranscribe, TaskError> {
    tracing::info!(
        video = %input.video_path,
        wav = %input.wav_path,
        "[taskmill-demo] 占位: Whisper + VAD 识别，生成字幕"
    );
    sleep(Duration::from_secs(3)).await;
    let subtitle_path = format!("{}.demo.srt", input.video_path);
    Ok(AfterTranscribe {
        video_path: input.video_path,
        wav_path: input.wav_path,
        subtitle_path,
    })
}

pub(crate) async fn step_translate_subtitle(
    input: AfterTranscribe,
) -> Result<AfterTranslate, TaskError> {
    tracing::info!(
        subtitle = %input.subtitle_path,
        "[taskmill-demo] 占位: 翻译字幕文件"
    );
    sleep(Duration::from_secs(2)).await;
    Ok(AfterTranslate {
        video_path: input.video_path,
        wav_path: input.wav_path,
        subtitle_path: input.subtitle_path.clone(),
        translated_subtitle_path: format!("{}.translated.demo.srt", input.subtitle_path),
    })
}
