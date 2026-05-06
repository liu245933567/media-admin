use crate::error::AppError;
use crate::state::AppState;
use crate::xunlei::{self, decode_subtitle_id, encode_subtitle_id, DownloadPayload};
use axum::extract::State;
use axum::Json;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::instrument;

#[derive(Debug, Deserialize)]
pub struct SearchBody {
    pub video_path: String,
}

#[derive(Serialize)]
pub struct SearchResponse {
    pub video_path: String,
    pub cid: String,
    pub items: Vec<SubtitleRow>,
}

#[derive(Serialize)]
pub struct SubtitleRow {
    pub id: String,
    pub name: String,
    pub langs: String,
    pub ext: String,
    pub is_hash_match: bool,
}

#[derive(Debug, Deserialize)]
pub struct DownloadBody {
    pub video_path: String,
    pub subtitle_id: String,
}

#[derive(Serialize)]
pub struct DownloadResponse {
    pub subtitle_path: String,
    pub record_id: i64,
}

#[instrument(skip(state), fields(video_path = body.video_path.as_str()))]
pub async fn search_subtitles(
    State(state): State<AppState>,
    Json(body): Json<SearchBody>,
) -> Result<Json<SearchResponse>, AppError> {
    let path = PathBuf::from(body.video_path.trim());
    if path.as_os_str().is_empty() {
        return Err(AppError::BadRequest("video_path 不能为空".into()));
    }
    if !path.is_absolute() {
        return Err(AppError::BadRequest(
            "video_path 必须为后端可访问的绝对路径".into(),
        ));
    }
    if !tokio::fs::try_exists(&path)
        .await
        .map_err(|e| AppError::Internal(e.into()))?
    {
        return Err(AppError::NotFound(format!(
            "找不到文件: {}",
            path.display()
        )));
    }
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    if !meta.is_file() {
        return Err(AppError::BadRequest("路径必须是视频文件".into()));
    }

    let cid = xunlei::thunder_cid_from_file(&path)
        .await
        .map_err(AppError::Internal)?;
    let filename = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or_else(|| AppError::BadRequest("无法解析文件名".into()))?;

    let root = state
        .xunlei
        .search_by_filename(filename)
        .await
        .map_err(|e| AppError::Upstream(format!("迅雷字幕接口失败: {e}")))?;

    if root.code != 0 {
        let detail = root.result.unwrap_or_default();
        return Err(AppError::Upstream(format!(
            "迅雷返回 code={} {}",
            root.code, detail
        )));
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

        items.push(SubtitleRow {
            id,
            name,
            langs,
            ext,
            is_hash_match,
        });
    }

    Ok(Json(SearchResponse {
        video_path: path.display().to_string(),
        cid,
        items,
    }))
}

#[instrument(skip(state), fields(video_path = body.video_path.as_str()))]
pub async fn download_subtitle(
    State(state): State<AppState>,
    Json(body): Json<DownloadBody>,
) -> Result<Json<DownloadResponse>, AppError> {
    let video = PathBuf::from(body.video_path.trim());
    if video.as_os_str().is_empty() {
        return Err(AppError::BadRequest("video_path 不能为空".into()));
    }
    if !video.is_absolute() {
        return Err(AppError::BadRequest(
            "video_path 必须为后端可访问的绝对路径".into(),
        ));
    }
    if !tokio::fs::try_exists(&video)
        .await
        .map_err(|e| AppError::Internal(e.into()))?
    {
        return Err(AppError::NotFound(format!(
            "找不到视频文件: {}",
            video.display()
        )));
    }

    let payload = decode_subtitle_id(&body.subtitle_id).map_err(|_| {
        AppError::BadRequest("subtitle_id 无效".into())
    })?;

    let bytes = state
        .xunlei
        .download_bytes(&payload.url)
        .await
        .map_err(|e| AppError::Upstream(format!("下载字幕失败: {e}")))?;

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

    let video_path_str = video.display().to_string();
    let subtitle_path_str = subtitle_path.display().to_string();
    let language = payload.language.clone();
    let format = Some(ext.clone());

    let record = sqlx::query(
        r#"INSERT INTO subtitle_records (video_path, subtitle_path, source, language, format)
           VALUES (?, ?, 'xunlei', ?, ?)"#,
    )
    .bind(&video_path_str)
    .bind(&subtitle_path_str)
    .bind(&language)
    .bind(&format)
    .execute(&state.pool)
    .await
    .map_err(|e| AppError::Internal(e.into()))?;

    Ok(Json(DownloadResponse {
        subtitle_path: subtitle_path_str,
        record_id: record.last_insert_rowid(),
    }))
}

fn normalize_ext(format: &str) -> String {
    let s = format.trim().trim_start_matches('.').to_lowercase();
    if s.is_empty() {
        return "srt".into();
    }
    s
}
