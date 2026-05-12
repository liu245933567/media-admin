use std::path::Path;

use anyhow::Result;
use ma_whisper::generate::recognize_video_voice;

use crate::{
    file::write_srt_file,
    types::{SubtitleGenerateConfig, SubtitleGenerateItem, SubtitleTranslateConfig},
    utils::same_language,
};

/// 生成完成后由调用方写入「字幕翻译任务」队列（不再在生成流程内同步翻译）。
pub struct PendingTranslateEnqueue {
    pub source_srt_path: String,
    pub config: SubtitleTranslateConfig,
}

pub struct SubtitleGenerateOutcome {
    pub items: Vec<SubtitleGenerateItem>,
    pub pending_translate: Option<PendingTranslateEnqueue>,
}

pub async fn generate_subtitle_by_video(
    config: &SubtitleGenerateConfig,
) -> Result<SubtitleGenerateOutcome> {
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

    let items = vec![SubtitleGenerateItem {
        srt_path: srt_path.display().to_string(),
    }];

    tracing::info!("[subtitle] 字幕生成完成: {}", srt_path.display());

    let pending_translate = match config.translate_cfg.as_ref() {
        None => None,
        Some(tc) => {
            if let Some(src) = detected_lang.as_deref() {
                if same_language(src, &tc.target_language) {
                    tracing::info!(
                        "[subtitle] 检测语种 {src} 与目标语种 {} 一致，不加入翻译队列",
                        tc.target_language
                    );
                    return Ok(SubtitleGenerateOutcome {
                        items,
                        pending_translate: None,
                    });
                }
            }

            if all_segments.is_empty() {
                tracing::info!("[subtitle] 无字幕条目，不加入翻译队列");
                None
            }
            else {
                tracing::info!(
                    "[subtitle] 已配置翻译，将由调用方加入翻译队列: {} -> {}",
                    detected_lang.as_deref().unwrap_or("auto"),
                    tc.target_language
                );
                Some(PendingTranslateEnqueue {
                    source_srt_path: srt_path.display().to_string(),
                    config: (*tc).clone(),
                })
            }
        },
    };

    Ok(SubtitleGenerateOutcome {
        items,
        pending_translate,
    })
}
