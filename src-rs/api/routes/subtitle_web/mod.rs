use crate::{
    api::StateRouter,
    core::subtitles_web::{download_subtitle, DownloadBody, DownloadResponse},
    error::AppError,
};
use axum::{routing::post, Json, Router};
use axum_extra::extract::WithRejection;

use crate::core::subtitles_web::{search_subtitles, SearchBody, SubtitleWebSearchRes};

pub fn routes() -> StateRouter {
    Router::new()
        .route("/search", post(search_handler))
        .route("/download", post(download_handler))
}

async fn search_handler(
    WithRejection(Json(body), _): WithRejection<Json<SearchBody>, AppError>,
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
