//! 高效视频字幕流水线：管道 PCM → Whisper 识别 → 清洗 → 写源 SRT；翻译由调用方独立入队。

use std::path::Path;

use anyhow::{Context, Result};
use ma_whisper::{generate::recognize_pcm_i16, wav::extract_pcm_i16_mono16k};
use tokio::task::spawn_blocking;

use crate::{
    file::write_srt_file,
    generate::{pending_translate_from, SubtitleGenerateOutcome},
    segment_filter::sanitize_whisper_segments,
    types::{SubtitleGenerateConfig, SubtitleGenerateItem},
};

/// 统一流水线：识别 → 清洗 → 写源 SRT；翻译通过 [`SubtitleGenerateOutcome::pending_translate`] 由调度器独立入队。
pub async fn generate_subtitle_pipeline(
    video_path: &Path,
    config: &SubtitleGenerateConfig,
) -> Result<SubtitleGenerateOutcome> {
    let video_path_str = video_path.display().to_string();
    tracing::info!("[pipeline] 开始: {video_path_str}");

    let samples = extract_pcm_i16_mono16k(video_path)
        .await
        .with_context(|| format!("提取 PCM 失败: {video_path_str}"))?;
    tracing::info!(
        "[pipeline] 已加载 PCM: {} 样本 (~{:.1}s)",
        samples.len(),
        samples.len() as f64 / 16_000.0
    );

    let vad_config = config.vad_config.clone();
    let whisper_engine_config = config.whisper_engine_config.clone();
    let whisper_transcribe_config = config.whisper_transcribe_config.clone();

    let recognize_output = spawn_blocking(move || {
        recognize_pcm_i16(
            &samples,
            vad_config,
            whisper_engine_config,
            whisper_transcribe_config,
        )
    })
    .await
    .context("Whisper 任务 join 失败")?
    .context("Whisper 识别失败")?;

    let detected_lang = recognize_output.lang;
    let raw_count = recognize_output.items.len();
    let source = sanitize_whisper_segments(recognize_output.items);

    tracing::info!(
        "[pipeline] 识别完成: 原始 {raw_count} 条 → 清洗后 {} 条, 语种 {:?}",
        source.len(),
        detected_lang
    );

    let source_srt_path =
        write_srt_file(video_path, None, &source, detected_lang.clone()).await?;

    let pending_translate = pending_translate_from(
        &source_srt_path,
        detected_lang.as_deref(),
        &source,
        config.translate_config.as_ref(),
    );

    tracing::info!("[pipeline] 源 SRT: {}", source_srt_path.display());

    Ok(SubtitleGenerateOutcome {
        items: vec![SubtitleGenerateItem {
            srt_path: source_srt_path.display().to_string(),
            translated_srt_path: None,
        }],
        pending_translate,
    })
}
