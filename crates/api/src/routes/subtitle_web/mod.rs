use crate::{
    core::subtitles_web::{download_subtitle, DownloadBody, DownloadResponse},
    error::AppError,
    StateRouter,
};
use axum::{routing::post, Json, Router};
use axum_extra::extract::WithRejection;

use crate::core::subtitles_web::{search_subtitles, SubtitleWebSearchReq, SubtitleWebSearchRes};

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
