use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{delete, get, post},
};
use axum_extra::extract::WithRejection;
use ma_service::media_library::{
    MediaRootCreateReq, MediaRootRow, MediaVideoDeleteReq, MediaVideoDeleteRes, MediaVideosPageRes,
    MediaVideosQuery, create_media_root, delete_media_root, delete_media_videos,
    enqueue_media_library_scan, list_media_roots, list_media_videos,
};

use crate::{AppState, StateRouter, error::AppError};

pub fn routes() -> StateRouter {
    Router::new()
        .route("/roots", get(list_roots_handler).post(create_root_handler))
        .route("/roots/{id}", delete(delete_root_handler))
        .route("/roots/{id}/scan", post(scan_root_handler))
        .route("/files", get(list_files_handler))
        .route("/videos/delete", post(delete_videos_handler))
}

#[utoipa::path(
    get,
    path = "/api/media-library/roots",
    operation_id = "listRootsMediaLibrary",
    tag = "media-library",
    responses((status = 200, body = Vec<MediaRootRow>))
)]
pub(crate) async fn list_roots_handler(
    State(state): State<AppState>,
) -> Result<Json<Vec<MediaRootRow>>, AppError> {
    let rows = list_media_roots(&state.db)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(rows))
}

#[utoipa::path(
    post,
    path = "/api/media-library/roots",
    operation_id = "createRootMediaLibrary",
    tag = "media-library",
    request_body = MediaRootCreateReq,
    responses((status = 200, body = MediaRootRow))
)]
pub(crate) async fn create_root_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<MediaRootCreateReq>, AppError>,
) -> Result<Json<MediaRootRow>, AppError> {
    let row = create_media_root(&state.db, body)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(row))
}

#[utoipa::path(
    delete,
    path = "/api/media-library/roots/{id}",
    operation_id = "deleteRootMediaLibrary",
    tag = "media-library",
    params(("id" = i64, Path, description = "媒体资源目录 ID")),
    responses((status = 200, body = bool))
)]
pub(crate) async fn delete_root_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<bool>, AppError> {
    let deleted = delete_media_root(&state.db, id)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(deleted))
}

#[utoipa::path(
    post,
    path = "/api/media-library/roots/{id}/scan",
    operation_id = "scanRootMediaLibrary",
    tag = "media-library",
    params(("id" = i64, Path, description = "媒体资源目录 ID")),
    responses((status = 200))
)]
pub(crate) async fn scan_root_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<()>, AppError> {
    enqueue_media_library_scan(&state.db, &state.taskmill, id)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(()))
}

#[utoipa::path(
    get,
    path = "/api/media-library/files",
    operation_id = "listFilesMediaLibrary",
    tag = "media-library",
    params(MediaVideosQuery),
    responses((status = 200, body = MediaVideosPageRes))
)]
pub(crate) async fn list_files_handler(
    State(state): State<AppState>,
    Query(q): Query<MediaVideosQuery>,
) -> Result<Json<MediaVideosPageRes>, AppError> {
    let rows = list_media_videos(&state.db, q)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(rows))
}

#[utoipa::path(
    post,
    path = "/api/media-library/videos/delete",
    operation_id = "deleteVideosMediaLibrary",
    tag = "media-library",
    request_body = MediaVideoDeleteReq,
    responses((status = 200, body = MediaVideoDeleteRes))
)]
pub(crate) async fn delete_videos_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<MediaVideoDeleteReq>, AppError>,
) -> Result<Json<MediaVideoDeleteRes>, AppError> {
    let res = delete_media_videos(&state.db, body)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(res))
}
