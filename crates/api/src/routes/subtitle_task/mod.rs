use std::path::Path;

use crate::{
    core::{
        subtitle_gen::generate_subtitle_with,
        subtitle_task::{
            create_subtitle_task, delete_subtitle_task, list_subtitle_tasks, SubtitleTaskCreateReq,
            SubtitleTaskCreateRes, SubtitleTaskDeleteReq, SubtitleTaskDeleteRes,
            SubtitleTaskListReq, SubtitleTaskListRes,
        },
        vad::VadConfig,
    },
    error::AppError,
    state::AppState,
    StateRouter,
};
use axum::{extract::State, routing::post, Json, Router};
use axum_extra::extract::WithRejection;

pub fn routes() -> StateRouter {
    Router::new()
        .route("/tasks/list", post(list_handler))
        .route("/tasks", post(create_handler))
        .route("/tasks/delete", post(delete_handler))
}

async fn create_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTaskCreateReq>, AppError>,
) -> Result<Json<SubtitleTaskCreateRes>, AppError> {
    let _ = generate_subtitle_with(
        &Path::new(&body.video_path),
        Some(VadConfig::default()),
        None,
        None,
        None,
    )
    .await?;
    let row = create_subtitle_task(&state.db, body)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(row))
}

async fn list_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTaskListReq>, AppError>,
) -> Result<Json<SubtitleTaskListRes>, AppError> {
    let page = list_subtitle_tasks(&state.db, body)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(page))
}

async fn delete_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTaskDeleteReq>, AppError>,
) -> Result<Json<SubtitleTaskDeleteRes>, AppError> {
    delete_subtitle_task(&state.db, body.task_id)
        .await
        .map_err(|e| {
            let m = e.to_string();
            if m == "任务不存在" || m == "处理中的任务不可删除" {
                AppError::BadRequest(m)
            } else {
                AppError::Internal(e)
            }
        })
        .map(Json)
}
