use std::path::PathBuf;

use media_admin::{core::vad::VadConfig, log::init_tracing};

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    init_tracing();

    let input_media_path = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("缺少要目标视频路径参数，用法: cargo run --example ffmpeg_whisper_minimal -- <input_media_path>"))
        .map(|s| PathBuf::from(s)).unwrap();

    let config = VadConfig::default();

    media_admin::core::subtitle_gen::generate_subtitle(&input_media_path, Some(config))
        .await
        .unwrap();
}
