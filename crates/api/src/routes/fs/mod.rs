use crate::{StateRouter, error::AppError};
use axum::{Json, Router, routing::post};
use axum_extra::extract::WithRejection;
use ma_service::fs::{
    FsDeleteReq, FsDeleteRes, FsListItem, FsListReq, FsReadTextReq, FsReadTextRes,
    delete_subtitle_file, get_fs_list, read_text_file,
};

pub fn routes() -> StateRouter {
    Router::new()
        .route("/list", post(list_handler))
        .route("/read-text", post(read_text_handler))
        .route("/delete-subtitle", post(delete_subtitle_handler))
}

async fn list_handler(
    WithRejection(Json(body), _): WithRejection<Json<FsListReq>, AppError>,
) -> Result<Json<Vec<FsListItem>>, AppError> {
    let resp = get_fs_list(body.parent_path).await?;

    Ok(Json(resp))
}

async fn read_text_handler(
    WithRejection(Json(body), _): WithRejection<Json<FsReadTextReq>, AppError>,
) -> Result<Json<FsReadTextRes>, AppError> {
    let resp = read_text_file(body.path).await?;
    Ok(Json(resp))
}

async fn delete_subtitle_handler(
    WithRejection(Json(body), _): WithRejection<Json<FsDeleteReq>, AppError>,
) -> Result<Json<FsDeleteRes>, AppError> {
    let resp = delete_subtitle_file(body.path)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(resp))
}
