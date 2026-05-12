use crate::{StateRouter, error::AppError};
use axum::{Json, Router, routing::post};
use axum_extra::extract::WithRejection;

use ma_service::subtitles_web::{
    DownloadBody, DownloadResponse, SubtitleWebSearchReq, SubtitleWebSearchRes, download_subtitle,
    search_subtitles,
};

pub fn routes() -> StateRouter {
    Router::new()
        .route("/search", post(search_handler))
        .route("/download", post(download_handler))
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
