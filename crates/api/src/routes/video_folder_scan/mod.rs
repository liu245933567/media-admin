use crate::{StateRouter, error::AppError};
use ma_service::video_folder_scan::{VideoFolderScanReq, VideoFolderScanRes, scan_video_folder};

use axum::{Json, Router, routing::post};
use axum_extra::extract::WithRejection;

pub fn routes() -> StateRouter {
    Router::new().route("/scan", post(scan_handler))
}

async fn scan_handler(
    WithRejection(Json(body), _): WithRejection<Json<VideoFolderScanReq>, AppError>,
) -> Result<Json<VideoFolderScanRes>, AppError> {
    let res = scan_video_folder(body).await.map_err(|e| {
        // 这里大多数是入参/路径错误，按 BadRequest 返回更友好
        AppError::BadRequest(e.to_string())
    })?;
    Ok(Json(res))
}
