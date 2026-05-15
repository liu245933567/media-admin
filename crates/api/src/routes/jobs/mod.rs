use axum::{
    Json, Router,
    extract::{Query, State},
    routing::{get, post},
};
use axum_extra::extract::WithRejection;
use ma_service::job::{
    SubtitleGenerateBulkReq, SubtitleGenerateBulkRes, SubtitleGenerateConfig,
    SubtitleGenerateDefaultsRes, SubtitleTranslateJob, TaskHistoryRecord, TaskmillSnapshot,
    TimestampedSchedulerEvent, bulk_enqueue_subtitle_generate, enqueue_subtitle_generate,
    subtitle_generate_defaults,
};
use serde::Deserialize;

use crate::{AppState, StateRouter, error::AppError};

#[derive(Debug, Deserialize)]
pub struct JobsHistoryQuery {
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
pub struct JobsExecLogQuery {
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
        .route("/generate-defaults", get(generate_defaults_handler))
        .route("/generate", post(generate_handler))
        .route("/generate/bulk", post(generate_bulk_handler))
        .route("/translate", post(translate_handler))
        .route("/snapshot", get(snapshot_handler))
        .route("/history", get(history_handler))
        .route("/exec-log", get(exec_log_handler))
}

async fn generate_defaults_handler() -> Json<SubtitleGenerateDefaultsRes> {
    Json(subtitle_generate_defaults())
}

async fn generate_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleGenerateConfig>, AppError>,
) -> Result<Json<()>, AppError> {
    enqueue_subtitle_generate(&state.taskmill, body)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(()))
}

async fn generate_bulk_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleGenerateBulkReq>, AppError>,
) -> Result<Json<SubtitleGenerateBulkRes>, AppError> {
    let res = bulk_enqueue_subtitle_generate(&state.taskmill, body)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(res))
}

async fn translate_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTranslateJob>, AppError>,
) -> Result<Json<()>, AppError> {
    state
        .taskmill
        .enqueue_translate(body)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(()))
}

async fn snapshot_handler(
    State(state): State<AppState>,
) -> Result<Json<TaskmillSnapshot>, AppError> {
    let snapshot = state
        .taskmill
        .snapshot()
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(snapshot))
}

async fn history_handler(
    State(state): State<AppState>,
    Query(q): Query<JobsHistoryQuery>,
) -> Result<Json<Vec<TaskHistoryRecord>>, AppError> {
    let (limit, offset) = clamp_history_params(q.limit, q.offset);
    let rows = state
        .taskmill
        .recent_history(limit, offset)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(rows))
}

async fn exec_log_handler(
    State(state): State<AppState>,
    Query(q): Query<JobsExecLogQuery>,
) -> Result<Json<Vec<TimestampedSchedulerEvent>>, AppError> {
    let limit = clamp_exec_log_limit(q.limit);
    let rows = state.taskmill.recent_exec_events(limit).await;
    Ok(Json(rows))
}
