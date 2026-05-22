use axum::{
    Json, Router,
    extract::{Path, Query, State},
    routing::{delete, get, post},
};
use axum_extra::extract::WithRejection;
use ma_service::job::{
    ScanGenerateSubtitleReq, ScanGenerateSubtitleRes, SubtitleGenerateBulkReq,
    SubtitleGenerateBulkRes, SubtitleGenerateDefaultsRes, SubtitleGenerateReq,
    SubtitleTranslateJobReq, TaskHistoryRecord, TaskRecord, TaskmillCancelRes, TaskmillControlOk,
    TaskmillDeleteHistoryRes, TaskmillSnapshot, TimestampedSchedulerEvent,
    bulk_enqueue_subtitle_generate, enqueue_subtitle_generate, enqueue_subtitle_translate_req,
    scan_and_enqueue_subtitle_generate, subtitle_generate_defaults,
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

#[derive(Debug, Deserialize)]
pub struct JobsActiveQuery {
    #[serde(default = "default_active_limit")]
    limit: i32,
}

fn default_active_limit() -> i32 {
    200
}

pub fn routes() -> StateRouter {
    Router::new()
        .route("/generate-defaults", get(generate_defaults_handler))
        .route("/generate", post(generate_handler))
        .route("/generate/bulk", post(generate_bulk_handler))
        .route("/scan-generate", post(scan_generate_handler))
        .route("/translate", post(translate_handler))
        .route("/snapshot", get(snapshot_handler))
        .route("/history", get(history_handler))
        .route("/history/{id}", delete(delete_history_handler))
        .route("/exec-log", get(exec_log_handler))
        .route("/active", get(active_tasks_handler))
        .route("/scheduler/pause", post(scheduler_pause_handler))
        .route("/scheduler/resume", post(scheduler_resume_handler))
        .route("/tasks/{id}/cancel", post(task_cancel_handler))
        .route("/tasks/{id}/pause", post(task_pause_handler))
        .route("/tasks/{id}/resume", post(task_resume_handler))
}

async fn generate_defaults_handler(
    State(state): State<AppState>,
) -> Json<SubtitleGenerateDefaultsRes> {
    let global = state.app_config.read().await;
    Json(subtitle_generate_defaults(&global))
}

async fn generate_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleGenerateReq>, AppError>,
) -> Result<Json<()>, AppError> {
    let global = state.app_config.read().await;
    enqueue_subtitle_generate(&state.taskmill, body, &global)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(()))
}

async fn generate_bulk_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleGenerateBulkReq>, AppError>,
) -> Result<Json<SubtitleGenerateBulkRes>, AppError> {
    let global = state.app_config.read().await;
    let res = bulk_enqueue_subtitle_generate(&state.taskmill, body, &global)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(res))
}

async fn scan_generate_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<ScanGenerateSubtitleReq>, AppError>,
) -> Result<Json<ScanGenerateSubtitleRes>, AppError> {
    let global = state.app_config.read().await;
    let res = scan_and_enqueue_subtitle_generate(&state.db, &state.taskmill, body, &global)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(res))
}

async fn translate_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTranslateJobReq>, AppError>,
) -> Result<Json<()>, AppError> {
    let global = state.app_config.read().await;
    enqueue_subtitle_translate_req(&state.taskmill, body, &global)
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

async fn active_tasks_handler(
    State(state): State<AppState>,
    Query(q): Query<JobsActiveQuery>,
) -> Result<Json<Vec<TaskRecord>>, AppError> {
    let rows = state
        .taskmill
        .list_active_tasks(q.limit)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(rows))
}

async fn scheduler_pause_handler(State(state): State<AppState>) -> Json<TaskmillControlOk> {
    state.taskmill.pause_scheduler().await;
    Json(TaskmillControlOk { ok: true })
}

async fn scheduler_resume_handler(State(state): State<AppState>) -> Json<TaskmillControlOk> {
    state.taskmill.resume_scheduler().await;
    Json(TaskmillControlOk { ok: true })
}

async fn task_cancel_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<TaskmillCancelRes>, AppError> {
    let cancelled = state
        .taskmill
        .cancel_task(id)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(TaskmillCancelRes { cancelled }))
}

async fn task_pause_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<TaskmillControlOk>, AppError> {
    state
        .taskmill
        .pause_task(id)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(TaskmillControlOk { ok: true }))
}

async fn task_resume_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<TaskmillControlOk>, AppError> {
    state
        .taskmill
        .resume_task(id)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(TaskmillControlOk { ok: true }))
}

async fn delete_history_handler(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Json<TaskmillDeleteHistoryRes>, AppError> {
    let deleted = state
        .taskmill
        .delete_history(id)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(TaskmillDeleteHistoryRes { deleted }))
}
