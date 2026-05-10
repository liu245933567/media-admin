use std::path::Path;

use anyhow::{Context, Result};
use ma_whisper::{
    generate::recognize_video_voice,
    types::{VadConfig, WhisperEngineConfig, WhisperTranscribeOptions},
};

use crate::{file::write_srt_file, types::SubtitleTranslateConfig, utils::same_language};

pub async fn generate_subtitle_by_video(
    video_path: &Path,
    vad_config: Option<VadConfig>,
    whisper_engine_cfg: Option<WhisperEngineConfig>,
    whisper_transcribe_options: Option<WhisperTranscribeOptions>,
    translate_cfg: Option<SubtitleTranslateConfig>,
) -> Result<()> {
    let recognize_result = recognize_video_voice(
        video_path,
        vad_config,
        whisper_engine_cfg,
        whisper_transcribe_options,
    )
    .await?;

    let detected_lang = recognize_result.lang;

    let srt_path = write_srt_file(
        video_path,
        None,
        &recognize_result.items,
        recognize_result.lang,
    )
    .with_context(|| format!("写入 SRT 失败: {}", video_path.display()))?;

    tracing::info!("[subtitle] 字幕生成完成: {}", srt_path.display());

    // 可选：翻译为目标语言
    if let Some(cfg) = translate_cfg {
        // 同语种短路：原文已经是目标语言，无需翻译
        if let Some(ref src) = detected_lang {
            if same_language(src, &cfg.options.target_language) {
                tracing::info!(
                    "[subtitle] 检测语种 {src} 与目标语种 {} 一致，跳过翻译",
                    cfg.options.target_language
                );
                return Ok(srt_path.display().to_string());
            }
        }

        if all_segments.is_empty() {
            tracing::info!("[subtitle] 无字幕条目，跳过翻译");
            return Ok(srt_path.display().to_string());
        }

        tracing::info!(
            "[subtitle] 开始翻译: {} -> {}",
            detected_lang.as_deref().unwrap_or("auto"),
            cfg.options.target_language
        );
        match translate_srt_file(&srt_path, None, cfg.options.clone()).await {
            Ok(translated) => {
                tracing::info!("[subtitle] 翻译完成: {}", translated.display());
                if cfg.remove_source_srt && translated != srt_path {
                    if let Err(e) = std::fs::remove_file(&srt_path) {
                        tracing::warn!(
                            "[subtitle] 删除原文 SRT 失败({}): {e:#}",
                            srt_path.display()
                        );
                    }
                }
                return Ok(translated.display().to_string());
            }
            Err(e) => {
                tracing::warn!("[subtitle] 翻译失败，保留原文 SRT: {e:#}");
            }
        }
    }

    Ok(srt_path.display().to_string())
}
