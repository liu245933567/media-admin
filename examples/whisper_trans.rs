use anyhow::{anyhow, Result};
use media_admin::{
    core::{
        subtitle_gen::generate_subtitle_with,
        vad::VadConfig,
        whisper::{WhisperEngineConfig, WhisperOptions},
    },
    log::init_tracing,
};
use std::path::PathBuf;

#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    init_tracing();

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
        // language: Some("zh".into()),
        // initial_prompt: Some("以下是普通话简体中文字幕。".into()),
        ..Default::default()
    };

    let engine_cfg = WhisperEngineConfig::default();

    let srt = generate_subtitle_with(
        &input_media_path,
        Some(vad),
        Some(engine_cfg),
        Some(options),
    )
    .await?;
    tracing::info!("SRT 已写入: {srt}");
    Ok(())
}
