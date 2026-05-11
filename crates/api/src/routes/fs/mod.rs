use crate::{
    core::fs::{get_fs_list, read_text_file, FsListItem, FsListReq, FsReadTextReq, FsReadTextRes},
    error::AppError,
    StateRouter,
};
use axum::{routing::post, Json, Router};
use axum_extra::extract::WithRejection;

pub fn routes() -> StateRouter {
    Router::new()
        .route("/list", post(list_handler))
        .route("/read-text", post(read_text_handler))
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
