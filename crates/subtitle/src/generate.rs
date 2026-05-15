use std::path::Path;

use anyhow::Result;
use ma_whisper::{
    generate::recognize_video_voice,
    types::{WhisperTranscribeItem, WhisperTranscribeOutput},
};

use crate::{
    file::write_srt_file,
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

/// 根据识别结果与配置，判断是否应链式入队翻译任务。
pub fn pending_translate_from(
    srt_path: &Path,
    detected_lang: Option<&str>,
    segments: &[WhisperTranscribeItem],
    translate_cfg: Option<&SubtitleTranslateConfig>,
) -> Option<PendingTranslateEnqueue> {
    let tc = translate_cfg?;

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

/// 兼容入口：单进程内完成「提取 WAV → VAD+Whisper → 写 SRT」。
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

    write_subtitle_outcome(config, recognize_result).await
}

/// 将 Whisper 识别结果写入 SRT，并计算是否需翻译。
pub async fn write_srt_from_recognize(
    video_path: &str,
    recognize_result: WhisperTranscribeOutput,
    translate_cfg: Option<&SubtitleTranslateConfig>,
) -> Result<SubtitleGenerateOutcome> {
    let detected_lang = recognize_result.lang;
    let all_segments = recognize_result.items;

    let srt_path = write_srt_file(
        &Path::new(video_path),
        None,
        &all_segments,
        detected_lang.clone(),
    )
    .await?;

    let items = vec![SubtitleGenerateItem {
        srt_path: srt_path.display().to_string(),
    }];

    tracing::info!("[subtitle] 字幕生成完成: {}", srt_path.display());

    let pending_translate = pending_translate_from(
        &srt_path,
        detected_lang.as_deref(),
        &all_segments,
        translate_cfg,
    );

    Ok(SubtitleGenerateOutcome {
        items,
        pending_translate,
    })
}

/// 将 Whisper 识别结果写入 SRT（使用完整生成配置）。
pub async fn write_subtitle_outcome(
    config: &SubtitleGenerateConfig,
    recognize_result: WhisperTranscribeOutput,
) -> Result<SubtitleGenerateOutcome> {
    write_srt_from_recognize(
        &config.video_path,
        recognize_result,
        config.translate_cfg.as_ref(),
    )
    .await
}
