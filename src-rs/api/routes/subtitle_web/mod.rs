use crate::{
    api::StateRouter,
    core::subtitles_web::{download_subtitle, DownloadBody, DownloadResponse},
    error::AppError,
};
use axum::{
    body::Bytes,
    extract::State,
    http::{header, HeaderMap, HeaderValue},
    response::IntoResponse,
    routing::post,
    Json, Router,
};
use axum_extra::extract::WithRejection;

use crate::core::subtitles_web::{search_subtitles, SubtitleWebSearchReq, SubtitleWebSearchRes};

pub fn routes() -> StateRouter {
    Router::new()
        .route("/search", post(search_handler))
        .route("/download", post(download_handler))
        .route("/download-bytes", post(download_bytes_handler))
}

async fn search_handler(
    WithRejection(Json(body), _): WithRejection<Json<SubtitleWebSearchReq>, AppError>,
) -> Result<Json<SubtitleWebSearchRes>, AppError> {
    let resp = search_subtitles(body).await?;
    Ok(Json(resp))
}

async fn download_handler(
    WithRejection(Json(body), _): WithRejection<Json<DownloadBody>, AppError>,
) -> Result<Json<DownloadResponse>, AppError> {
    let resp = download_subtitle(body).await?;
    Ok(Json(resp))
}

async fn download_bytes_handler(
    State(_state): State<crate::state::AppState>,
    WithRejection(Json(body), _): WithRejection<Json<DownloadBody>, AppError>,
) -> Result<impl IntoResponse, AppError> {
    // 复用 core 的 decode + 下载逻辑，但不落盘，直接给浏览器下载
    let payload = crate::core::xunlei::decode_subtitle_id(&body.subtitle_id)
        .map_err(|_| AppError::BadRequest("subtitle_id 无效".into()))?;

    let xunlei_client = crate::core::xunlei::ThunderSubtitleClient::new()
        .map_err(|e| AppError::Internal(e.into()))?;

    let bytes = xunlei_client
        .download_bytes(&payload.url)
        .await
        .map_err(|e| AppError::BadRequest(format!("下载字幕失败: {e}")))?;

    let ext = payload
        .format
        .trim()
        .trim_start_matches('.')
        .to_lowercase();
    let ext = if ext.is_empty() { "srt".to_string() } else { ext };

    let filename = std::path::PathBuf::from(body.video_path.trim())
        .file_stem()
        .and_then(|s| s.to_str())
        .map(|stem| format!("{stem}.{ext}"))
        .unwrap_or_else(|| format!("subtitle.{ext}"));

    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(
        header::CONTENT_DISPOSITION,
        HeaderValue::from_str(&format!("attachment; filename=\"{filename}\""))
            .map_err(|e| AppError::Internal(e.into()))?,
    );

    Ok((headers, Bytes::from(bytes)))
}
