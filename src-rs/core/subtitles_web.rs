use crate::core::xunlei::{
    decode_subtitle_id, encode_subtitle_id, thunder_cid_from_file, DownloadPayload,
    ThunderSubtitleClient,
};
use crate::error::AppError;
use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use typeshare::typeshare;

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleWebSearchReq {
    pub video_path: String,
}

/// 搜索字幕结果
#[typeshare]
#[derive(Serialize)]
pub struct SubtitleWebSearchRes {
    /// 视频的绝对路径
    pub video_path: String,
    /// 视频的 cid
    pub cid: String,
    /// 字幕列表
    pub items: Vec<SubtitleWebRow>,
}

/// 搜索字幕结果 - 列表单项
#[typeshare]
#[derive(Serialize)]
pub struct SubtitleWebRow {
    pub id: String,
    pub name: String,
    pub langs: String,
    pub ext: String,
    pub is_hash_match: bool,
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct DownloadBody {
    pub video_path: String,
    pub subtitle_id: String,
}

#[typeshare]
#[derive(Serialize)]
pub struct DownloadResponse {
    pub subtitle_path: String,
    pub record_id: i32,
}

/// 从网络接口查询字幕
pub async fn search_subtitles(params: SubtitleWebSearchReq) -> Result<SubtitleWebSearchRes> {
    let path = PathBuf::from(&params.video_path.trim());
    if path.as_os_str().is_empty() {
        bail!("video_path 不能为空");
    }
    if !path.is_absolute() {
        bail!("video_path 必须为后端可访问的绝对路径");
    }
    if !tokio::fs::try_exists(&path).await? {
        bail!("找不到文件: {}", path.display());
    }
    let meta = tokio::fs::metadata(&path).await?;
    if !meta.is_file() {
        bail!("路径必须是视频文件");
    }

    let cid = thunder_cid_from_file(&path).await?;

    let filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .context("无法解析文件名")?;

    let xunlei_client = ThunderSubtitleClient::new().unwrap();

    let root = xunlei_client
        .search_by_filename(filename)
        .await
        .map_err(|e| anyhow!("迅雷字幕接口失败: {e}"))?;

    if root.code != 0 {
        let detail = root.result.unwrap_or_default();
        bail!("迅雷返回 code={} {}", root.code, detail);
    }

    let mut items = Vec::new();
    for row in root.data.unwrap_or_default() {
        let name = row.name.clone().unwrap_or_default();
        if name.is_empty() {
            continue;
        }
        let url = row.url.clone().unwrap_or_default();
        if url.is_empty() {
            continue;
        }
        let ext = row.ext.clone().unwrap_or_else(|| "srt".into());
        let langs = row
            .languages
            .as_ref()
            .map(|v| v.join(","))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "未知".into());

        let item_cid = row.cid.clone().unwrap_or_default();
        let is_hash_match = !item_cid.is_empty() && item_cid.eq_ignore_ascii_case(&cid);

        let payload = DownloadPayload {
            url,
            format: ext.clone(),
            language: Some("chi".into()),
            two_letter_iso_language_name: Some("zh".into()),
        };
        let id = encode_subtitle_id(&payload).map_err(AppError::Internal)?;

        items.push(SubtitleWebRow {
            id,
            name,
            langs,
            ext,
            is_hash_match,
        });
    }

    Ok(SubtitleWebSearchRes {
        video_path: path.display().to_string(),
        cid,
        items,
    })
}
/// 下载字幕
pub async fn download_subtitle(params: DownloadBody) -> Result<DownloadResponse> {
    let video = PathBuf::from(params.video_path.trim());
    if video.as_os_str().is_empty() {
        bail!("video_path 不能为空");
    }
    if !video.is_absolute() {
        bail!("video_path 必须为后端可访问的绝对路径");
    }
    if !tokio::fs::try_exists(&video)
        .await
        .map_err(|_e| anyhow!("找不到视频文件: {}", video.display()))?
    {
        bail!("找不到视频文件: {}", video.display());
    }

    let payload =
        decode_subtitle_id(&params.subtitle_id).map_err(|_| anyhow!("subtitle_id 无效"))?;

    let xunlei_client = ThunderSubtitleClient::new().unwrap();

    let bytes = xunlei_client
        .download_bytes(&payload.url)
        .await
        .map_err(|e| anyhow!("下载字幕失败: {e}"))?;

    let stem = video
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::BadRequest("无法解析视频主文件名".into()))?;

    let ext = normalize_ext(&payload.format);
    let parent = video
        .parent()
        .ok_or_else(|| AppError::BadRequest("无法解析视频目录".into()))?;
    let subtitle_path = parent.join(format!("{stem}.{ext}"));

    tokio::fs::write(&subtitle_path, &bytes)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    let subtitle_path_str = subtitle_path.display().to_string();

    Ok(DownloadResponse {
        subtitle_path: subtitle_path_str,
        record_id: 0,
    })
}

fn normalize_ext(format: &str) -> String {
    let s = format.trim().trim_start_matches('.').to_lowercase();
    if s.is_empty() {
        return "srt".into();
    }
    s
}

