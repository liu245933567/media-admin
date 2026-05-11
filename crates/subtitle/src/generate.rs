use std::path::Path;

use anyhow::Result;
use ma_whisper::generate::recognize_video_voice;

use crate::{
    file::write_srt_file,
    translate::translate_srt_file,
    types::{SubtitleGenerateConfig, SubtitleGenerateItem},
    utils::same_language,
};

pub async fn generate_subtitle_by_video(
    config: &SubtitleGenerateConfig,
) -> Result<Vec<SubtitleGenerateItem>> {
    let video_path = Path::new(&config.video_path);

    let recognize_result = recognize_video_voice(
        video_path,
        config.vad_config.clone(),
        config.whisper_engine_cfg.clone(),
        config.whisper_transcribe_options.clone(),
    )
    .await?;

    let detected_lang = recognize_result.lang;
    let all_segments = recognize_result.items;

    let srt_path = write_srt_file(
        &Path::new(&config.video_path),
        None,
        &all_segments,
        detected_lang.clone(),
    )
    .await?;

    let mut generate_items = vec![SubtitleGenerateItem {
        srt_path: srt_path.display().to_string(),
    }];

    tracing::info!("[subtitle] 字幕生成完成: {}", srt_path.display());

    // 可选：翻译为目标语言
    if let Some(cfg) = config.translate_cfg.as_ref() {
        // 同语种短路：原文已经是目标语言，无需翻译
        if let Some(src) = detected_lang.as_deref() {
            if same_language(src, &cfg.target_language) {
                tracing::info!(
                    "[subtitle] 检测语种 {src} 与目标语种 {} 一致，跳过翻译",
                    cfg.target_language
                );
                return Ok(generate_items);
            }
        }

        if all_segments.is_empty() {
            tracing::info!("[subtitle] 无字幕条目，跳过翻译");
            return Ok(generate_items);
        }

        tracing::info!(
            "[subtitle] 开始翻译: {} -> {}",
            detected_lang.as_deref().unwrap_or("auto"),
            cfg.target_language
        );

        match translate_srt_file(&srt_path, None, cfg).await {
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

                generate_items.push(SubtitleGenerateItem {
                    srt_path: translated.display().to_string(),
                });
                return Ok(generate_items);
            }
            Err(e) => {
                tracing::warn!("[subtitle] 翻译失败，保留原文 SRT: {e:#}");
            }
        }
    }

    Ok(generate_items)
}
