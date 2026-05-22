use std::path::Path;

use anyhow::Result;
use ma_whisper::types::{WhisperTranscribeItem, WhisperTranscribeOutput};

use crate::{
    file::write_srt_file,
    segment_filter::sanitize_whisper_segments,
    types::{SubtitleGenerateConfig, SubtitleGenerateItem, SubtitleTranslateConfig},
    utils::same_language,
};

/// 生成完成后由调用方入队「字幕翻译」任务。
pub struct PendingTranslateEnqueue {
    pub source_srt_path: String,
    pub config: SubtitleTranslateConfig,
}

pub struct SubtitleGenerateOutcome {
    pub items: Vec<SubtitleGenerateItem>,
    pub pending_translate: Option<PendingTranslateEnqueue>,
}

/// 是否应在生成后执行翻译（与 [`pending_translate_from`] 规则一致）。
pub fn should_chain_translate(
    detected_lang: Option<&str>,
    segments: &[WhisperTranscribeItem],
    translate_config: Option<&SubtitleTranslateConfig>,
) -> Option<SubtitleTranslateConfig> {
    let tc = translate_config?.clone();
    if let Some(src) = detected_lang {
        if same_language(src, &tc.target_language) {
            tracing::info!(
                "[subtitle] 检测语种 {src} 与目标语种 {} 一致，跳过翻译",
                tc.target_language
            );
            return None;
        }
    }
    if segments.is_empty() {
        tracing::info!("[subtitle] 无字幕条目，跳过翻译");
        return None;
    }
    tracing::info!(
        "[subtitle] 将翻译: {} -> {}",
        detected_lang.unwrap_or("auto"),
        tc.target_language
    );
    Some(tc)
}

/// 根据识别结果与配置，判断是否应链式入队翻译任务。
pub fn pending_translate_from(
    srt_path: &Path,
    detected_lang: Option<&str>,
    segments: &[WhisperTranscribeItem],
    translate_config: Option<&SubtitleTranslateConfig>,
) -> Option<PendingTranslateEnqueue> {
    let tc = translate_config?;

    if let Some(src) = detected_lang {
        if same_language(src, &tc.target_language) {
            tracing::info!(
                "[subtitle] 检测语种 {src} 与目标语种 {} 一致，不加入翻译队列",
                tc.target_language
            );
            return None;
        }
    }

    if segments.is_empty() {
        tracing::info!("[subtitle] 无字幕条目，不加入翻译队列");
        return None;
    }

    tracing::info!(
        "[subtitle] 已配置翻译，将入队翻译任务: {} -> {}",
        detected_lang.unwrap_or("auto"),
        tc.target_language
    );
    Some(PendingTranslateEnqueue {
        source_srt_path: srt_path.display().to_string(),
        config: tc.clone(),
    })
}

/// 兼容入口：委托 [`crate::pipeline::generate_subtitle_pipeline`]。
pub async fn generate_subtitle_by_video(
    video_path: &Path,
    config: &SubtitleGenerateConfig,
) -> Result<SubtitleGenerateOutcome> {
    crate::pipeline::generate_subtitle_pipeline(video_path, config).await
}

/// 将 Whisper 识别结果写入 SRT，并计算是否需翻译。
pub async fn write_srt_from_recognize(
    video_path: &str,
    recognize_result: WhisperTranscribeOutput,
    translate_config: Option<&SubtitleTranslateConfig>,
) -> Result<SubtitleGenerateOutcome> {
    let detected_lang = recognize_result.lang;
    let all_segments = sanitize_whisper_segments(recognize_result.items);

    let srt_path = write_srt_file(
        &Path::new(video_path),
        None,
        &all_segments,
        detected_lang.clone(),
    )
    .await?;

    let items = vec![SubtitleGenerateItem {
        srt_path: srt_path.display().to_string(),
        translated_srt_path: None,
    }];

    tracing::info!("[subtitle] 字幕生成完成: {}", srt_path.display());

    let pending_translate = pending_translate_from(
        &srt_path,
        detected_lang.as_deref(),
        &all_segments,
        translate_config,
    );

    Ok(SubtitleGenerateOutcome {
        items,
        pending_translate,
    })
}

/// 将 Whisper 识别结果写入 SRT（使用完整生成配置）。
pub async fn write_subtitle_outcome(
    video_path: &str,
    config: &SubtitleGenerateConfig,
    recognize_result: WhisperTranscribeOutput,
) -> Result<SubtitleGenerateOutcome> {
    write_srt_from_recognize(
        video_path,
        recognize_result,
        config.translate_config.as_ref(),
    )
    .await
}
