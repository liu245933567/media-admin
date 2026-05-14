use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use axum_extra::extract::WithRejection;
use ma_service::job::{
    TaskHistoryRecord, TaskmillDemoSnapshot, TimestampedSchedulerEvent,
    TranslateSubtitleOnlyInput, VideoSubtitlePipelineInput,
};
use serde::Deserialize;

use crate::{AppState, StateRouter, error::AppError};

#[derive(Debug, Deserialize)]
pub struct JobDemoHistoryQuery {
    #[serde(default = "default_history_limit")]
    limit: i32,
    #[serde(default)]
    offset: i32,
}

fn default_history_limit() -> i32 {
    50
}

fn clamp_history_params(limit: i32, offset: i32) -> (i32, i32) {
    (limit.clamp(1, 200), offset.max(0))
}

#[derive(Debug, Deserialize)]
pub struct JobDemoExecLogQuery {
    #[serde(default = "default_exec_log_limit")]
    limit: usize,
}

fn default_exec_log_limit() -> usize {
    250
}

fn clamp_exec_log_limit(limit: usize) -> usize {
    limit.clamp(1, 500)
}

pub fn routes() -> StateRouter {
    Router::new()
        .route("/pipeline", post(pipeline_handler))
        .route("/translate-subtitle", post(translate_handler))
        .route("/snapshot", get(snapshot_handler))
        .route("/history", get(history_handler))
        .route("/exec-log", get(exec_log_handler))
}

async fn pipeline_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<VideoSubtitlePipelineInput>, AppError>,
) -> Result<Json<()>, AppError> {
    state
        .taskmill_demo
        .enqueue_video_pipeline(body)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(()))
}

async fn translate_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<TranslateSubtitleOnlyInput>, AppError>,
) -> Result<Json<()>, AppError> {
    state
        .taskmill_demo
        .enqueue_translate_only(body)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(()))
}

async fn snapshot_handler(
    State(state): State<AppState>,
) -> Result<Json<TaskmillDemoSnapshot>, AppError> {
    let snapshot = state
        .taskmill_demo
        .snapshot()
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(snapshot))
}

async fn history_handler(
    State(state): State<AppState>,
    Query(q): Query<JobDemoHistoryQuery>,
) -> Result<Json<Vec<TaskHistoryRecord>>, AppError> {
    let (limit, offset) = clamp_history_params(q.limit, q.offset);
    let rows = state
        .taskmill_demo
        .recent_history(limit, offset)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(rows))
}

async fn exec_log_handler(
    State(state): State<AppState>,
    Query(q): Query<JobDemoExecLogQuery>,
) -> Result<Json<Vec<TimestampedSchedulerEvent>>, AppError> {
    let limit = clamp_exec_log_limit(q.limit);
    let rows = state.taskmill_demo.recent_exec_events(limit).await;
    Ok(Json(rows))
}
