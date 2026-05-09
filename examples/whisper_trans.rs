use anyhow::{anyhow, Result};
use media_admin::{
    core::{
        openai::TranslateOptions,
        subtitle_gen::{generate_subtitle_with, SubtitleTranslateConfig},
        vad::VadConfig,
        whisper::{WhisperEngineConfig, WhisperOptions},
    },
    log::init_tracing,
};
use std::path::PathBuf;
use std::time::Instant;

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    init_tracing();

    let started = Instant::now();

    let input_media_path: PathBuf = std::env::args()
        .nth(1)
        .ok_or_else(|| {
            anyhow!(
                "缺少要目标视频路径参数，用法: cargo run --example whisper_trans -- <input_media_path>"
            )
        })
        .map(PathBuf::from)?;

    let vad = VadConfig::default();

    // 解码参数：可在此处指定语言、initial_prompt 等。
    // 默认 Greedy(best_of=5) + 抑制幻觉 + 自动增益，与本机 whisper.cpp CUDA 后端兼容。
    let options = WhisperOptions {
        // language: Some("auto".into()), // 自动识别语种
        // language: Some("zh".into()),
        // initial_prompt: Some("以下是普通话简体中文字幕。".into()),
        ..Default::default()
    };

    let engine_cfg = WhisperEngineConfig::default();

    // 可选：翻译为目标语言。需要 SILICONFLOW_API_KEY（环境变量或显式传入）。
    // 启用翻译示例：
    //   use media_admin::core::openai::TranslateOptions;
    let translate = Some(SubtitleTranslateConfig {
        options: TranslateOptions {
            target_language: "Chinese".into(),
            ..Default::default()
        },
        remove_source_srt: false, // true 则翻译完成后删除原文 SRT
    });
    // let translate = None;

    let srt = generate_subtitle_with(
        &input_media_path,
        Some(vad),
        Some(engine_cfg),
        Some(options),
        translate,
    )
    .await?;

    let elapsed = started.elapsed();
    tracing::info!("SRT 已写入: {srt}（总耗时 {}）", format_duration(elapsed));
    Ok(())
}

/// 把 `Duration` 格式化为 `H:MM:SS.mmm` / `MM:SS.mmm` / `SS.mmms` 三档可读字符串
fn format_duration(d: std::time::Duration) -> String {
    let total_ms = d.as_millis();
    let ms = (total_ms % 1000) as u32;
    let total_s = total_ms / 1000;
    let s = (total_s % 60) as u32;
    let total_m = total_s / 60;
    let m = (total_m % 60) as u32;
    let h = total_m / 60;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}.{ms:03}")
    } else if m > 0 {
        format!("{m:02}:{s:02}.{ms:03}")
    } else {
        format!("{s}.{ms:03}s")
    }
}
