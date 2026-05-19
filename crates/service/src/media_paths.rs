//! 本地媒体文件路径校验（视频 / 字幕扩展名）。

use std::path::Path;

use anyhow::{Result, bail};

/// 是否为支持流式播放的视频文件。
pub fn is_video_file(path: &Path) -> bool {
    matches!(
        ext_lower(path),
        Some(
            "mp4" | "mkv" | "mov" | "avi" | "webm" | "flv" | "m4v" | "ts" | "wmv" | "m2ts" | "mts"
        )
    )
}

/// 按扩展名返回 `Content-Type`。
pub fn video_mime_type(path: &Path) -> &'static str {
    match ext_lower(path) {
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("mov") => "video/quicktime",
        Some("avi") => "video/x-msvideo",
        Some("flv") => "video/x-flv",
        Some("ts" | "m2ts" | "mts") => "video/mp2t",
        Some("wmv") => "video/x-ms-wmv",
        _ => "application/octet-stream",
    }
}

/// 校验绝对路径且为支持的视频文件（存在、非目录、扩展名白名单）。
pub async fn validate_video_path(path: &Path) -> Result<()> {
    if !path.is_absolute() {
        bail!("path 必须为绝对路径");
    }
    if !tokio::fs::try_exists(path).await? {
        bail!("path 不存在");
    }
    let meta = tokio::fs::metadata(path).await?;
    if !meta.is_file() {
        bail!("path 不能为目录");
    }
    if !is_video_file(path) {
        bail!("不支持的视频文件类型");
    }
    Ok(())
}

fn ext_lower(path: &Path) -> Option<&'static str> {
    let ext = path.extension()?.to_string_lossy().to_lowercase();
    match ext.as_str() {
        "mp4" => Some("mp4"),
        "mkv" => Some("mkv"),
        "mov" => Some("mov"),
        "avi" => Some("avi"),
        "webm" => Some("webm"),
        "flv" => Some("flv"),
        "m4v" => Some("m4v"),
        "ts" => Some("ts"),
        "wmv" => Some("wmv"),
        "m2ts" => Some("m2ts"),
        "mts" => Some("mts"),
        _ => None,
    }
}
