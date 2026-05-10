use crate::{
    StateRouter,
    core::fs::{get_fs_list, FsListItem, FsListReq},
    error::AppError,
};
use axum::{routing::post, Json, Router};
use axum_extra::extract::WithRejection;

pub fn routes() -> StateRouter {
    Router::new().route("/list", post(list_handler))
}

async fn list_handler(
    WithRejection(Json(body), _): WithRejection<Json<FsListReq>, AppError>,
) -> Result<Json<Vec<FsListItem>>, AppError> {
    let resp = get_fs_list(body.parent_path).await?;

    Ok(Json(resp))
}
