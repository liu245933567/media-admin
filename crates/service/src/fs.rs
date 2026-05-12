use std::{
    path::{Path, PathBuf},
    time,
};

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};

#[typeshare::typeshare]
#[derive(Debug, Deserialize)]
pub struct FsListReq {
    pub parent_path: Option<String>,
}

#[typeshare::typeshare]
#[derive(Debug, Deserialize)]
pub struct FsReadTextReq {
    pub path: String,
}

#[typeshare::typeshare]
#[derive(Debug, Serialize)]
pub struct FsReadTextRes {
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct FsListItem {
    pub name: String,
    pub full_path: String,
    pub is_dir: bool,
    pub size: u64,
    pub last_modified: time::SystemTime,
}

fn default_root_dir() -> Result<PathBuf> {
    if cfg!(windows) {
        // Windows 下如果没有指定路径，交给“盘符列表”逻辑处理，这里返回一个占位值。
        Ok(PathBuf::from("\\"))
    } else {
        Ok(PathBuf::from("/"))
    }
}

fn windows_drive_items() -> Vec<FsListItem> {
    // 用最轻量的方式探测盘符：A..Z，存在则加入列表。
    let mut items = Vec::new();
    for letter in b'A'..=b'Z' {
        let drive = format!("{}:\\", letter as char);
        let p = Path::new(&drive);
        if p.exists() {
            items.push(FsListItem {
                name: format!("{}:", letter as char),
                full_path: drive,
                is_dir: true,
                size: 0,
                last_modified: time::SystemTime::UNIX_EPOCH,
            });
        }
    }
    items
}

/// 获取文件列表
pub async fn get_fs_list(parent_path: Option<String>) -> Result<Vec<FsListItem>> {
    if cfg!(windows) && parent_path.is_none() {
        return Ok(windows_drive_items());
    }

    let parent_path = match parent_path {
        Some(p) => PathBuf::from(p),
        None => default_root_dir()?,
    };

    if !parent_path.is_absolute() {
        bail!("path 必须为绝对路径");
    }
    if !parent_path.exists() {
        bail!("path 不存在");
    }
    let mut entries = tokio::fs::read_dir(&parent_path).await?;
    let mut list = Vec::new();

    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name().to_string_lossy().to_string();
        let child_path = entry.path();
        let metadata = entry.metadata().await?;
        let last_modified = metadata.modified()?;
        let size = metadata.len();

        list.push(FsListItem {
            name,
            full_path: child_path.to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size,
            last_modified,
        });
    }
    Ok(list)
}

/// 读取文本文件（用于预览字幕内容）
pub async fn read_text_file(path: String) -> Result<FsReadTextRes> {
    let p = PathBuf::from(&path);
    if !p.is_absolute() {
        bail!("path 必须为绝对路径");
    }
    if !p.exists() {
        bail!("path 不存在");
    }
    if p.is_dir() {
        bail!("path 不能为目录");
    }

    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let allowed = ["srt", "ass", "ssa", "vtt"];
    if !allowed.contains(&ext.as_str()) {
        bail!("不支持读取该文件类型");
    }

    let meta = tokio::fs::metadata(&p).await?;
    // 防止一次性读取过大文件导致内存压力
    const MAX: u64 = 2 * 1024 * 1024;
    if meta.len() > MAX {
        bail!("文件过大，无法预览（> 2MB）");
    }

    let bytes = tokio::fs::read(&p).await?;
    let content = String::from_utf8_lossy(&bytes).to_string();
    Ok(FsReadTextRes { content })
}
