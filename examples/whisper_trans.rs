use anyhow::anyhow;
use media_admin::{
    core::{subtitle_gen::generate_subtitle, vad::VadConfig},
    log::init_tracing,
};
use std::path::PathBuf;

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    init_tracing();

    let input_media_path = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow!("缺少要目标视频路径参数，用法: cargo run --example whisper_trans -- <input_media_path>"))
        .map(|s| PathBuf::from(s)).unwrap();

    let config = VadConfig::default();

    generate_subtitle(&input_media_path, Some(config))
        .await
        .unwrap();
}
