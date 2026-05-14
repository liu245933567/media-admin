use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    ffi::OsStr,
    fs::Metadata,
    path::{Path, PathBuf},
};
use typeshare::typeshare;

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct VideoFolderScanReq {
    pub root_dir: String,
}

#[typeshare]
#[derive(Debug, Serialize)]
pub struct VideoFolderScanItem {
    pub video_name: String,
    pub video_path: String,
    pub video_size: u32,
    /// 同目录、同 stem 的字幕文件名列表（不含路径）
    pub subtitle_names: Vec<String>,
}

#[typeshare]
#[derive(Debug, Serialize)]
pub struct VideoFolderScanRes {
    pub items: Vec<VideoFolderScanItem>,
}

pub async fn scan_video_folder(params: VideoFolderScanReq) -> Result<VideoFolderScanRes> {
    let root_dir = params.root_dir.trim().to_string();
    if root_dir.is_empty() {
        bail!("root_dir 不能为空");
    }
    let root = PathBuf::from(&root_dir);
    if !root.is_absolute() {
        bail!("root_dir 必须为绝对路径");
    }
    if !tokio::fs::try_exists(&root).await? {
        bail!("root_dir 不存在");
    }
    let meta = tokio::fs::metadata(&root).await?;
    if !meta.is_dir() {
        bail!("root_dir 必须为目录");
    }

    let mut items: Vec<VideoFolderScanItem> = Vec::new();

    // 用显式栈避免递归导致栈溢出
    let mut stack: Vec<PathBuf> = vec![root];
    while let Some(dir) = stack.pop() {
        let mut rd = match tokio::fs::read_dir(&dir).await {
            Ok(v) => v,
            Err(_e) => continue,
        };

        // 先收集本目录条目：需要在同一目录内完成“字幕按 stem 聚合”
        let mut videos: Vec<(PathBuf, Metadata)> = Vec::new();
        let mut subtitle_by_stem: HashMap<String, Vec<String>> = HashMap::new();
        let mut subtitle_stems: Vec<String> = Vec::new();

        while let Ok(Some(ent)) = rd.next_entry().await {
            let child = ent.path();
            let md = match ent.metadata().await {
                Ok(v) => v,
                Err(_e) => continue,
            };
            if md.is_dir() {
                stack.push(child);
                continue;
            }
            if !md.is_file() {
                continue;
            }

            if is_video_file(&child) {
                videos.push((child, md));
                continue;
            }
            if is_subtitle_file(&child) {
                let Some(stem) = file_stem_string(&child) else {
                    continue;
                };
                let Some(name) = file_name_string(&child) else {
                    continue;
                };
                subtitle_by_stem.entry(stem).or_default().push(name);
            }
        }

        for (video_path, md) in videos {
            let Some(stem) = file_stem_string(&video_path) else {
                continue;
            };
            if subtitle_stems.is_empty() {
                subtitle_stems = subtitle_by_stem.keys().cloned().collect();
            }

            // 匹配逻辑：
            // - 同 stem：asdf.mp4 -> asdf.srt
            // - stem 以 "asdf." 前缀开头：asdf.mp4 -> asdf.en.srt / asdf.zh.srt / ...
            let mut subtitle_names = subtitle_by_stem.remove(&stem).unwrap_or_default();
            let prefix = format!("{stem}.");
            for sub_stem in subtitle_stems.iter() {
                if sub_stem.starts_with(&prefix) {
                    if let Some(mut v) = subtitle_by_stem.remove(sub_stem) {
                        subtitle_names.append(&mut v);
                    }
                }
            }
            subtitle_names.sort();
            subtitle_names.dedup();

            let Some(video_name) = file_name_string(&video_path) else {
                continue;
            };
            items.push(VideoFolderScanItem {
                video_name,
                video_path: video_path.to_string_lossy().to_string(),
                video_size: md.len() as u32,
                subtitle_names,
            });
        }
    }

    // 稳定排序：按路径升序
    items.sort_by(|a, b| a.video_path.cmp(&b.video_path));

    Ok(VideoFolderScanRes { items })
}

fn is_video_file(path: &Path) -> bool {
    match ext_lower(path) {
        Some("mp4") | Some("mkv") | Some("mov") | Some("avi") | Some("webm") | Some("flv")
        | Some("m4v") | Some("ts") | Some("wmv") | Some("m2ts") | Some("mts") => true,
        _ => false,
    }
}

fn is_subtitle_file(path: &Path) -> bool {
    match ext_lower(path) {
        Some("srt") | Some("ass") | Some("vtt") | Some("sub") | Some("smi") | Some("ssa") => true,
        _ => false,
    }
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
        "srt" => Some("srt"),
        "ass" => Some("ass"),
        "vtt" => Some("vtt"),
        "sub" => Some("sub"),
        "smi" => Some("smi"),
        "ssa" => Some("ssa"),
        _ => None,
    }
}

fn file_stem_string(path: &Path) -> Option<String> {
    path.file_stem()
        .and_then(OsStr::to_str)
        .map(|s| s.to_string())
}

fn file_name_string(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(OsStr::to_str)
        .map(|s| s.to_string())
}
