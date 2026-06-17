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
use utoipa::{IntoParams, ToSchema};

use crate::{AppState, StateRouter, error::AppError};

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
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

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
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

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
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

#[utoipa::path(
    get,
    path = "/api/jobs/generate-defaults",
    operation_id = "generateDefaultsJobs",
    tag = "jobs",
    responses((status = 200, body = SubtitleGenerateDefaultsRes))
)]
pub(crate) async fn generate_defaults_handler(
    State(state): State<AppState>,
) -> Json<SubtitleGenerateDefaultsRes> {
    let global = state.app_config.read().await;
    Json(subtitle_generate_defaults(&global))
}

#[utoipa::path(
    post,
    path = "/api/jobs/generate",
    operation_id = "generateJobs",
    tag = "jobs",
    request_body = SubtitleGenerateReq,
    responses((status = 200))
)]
pub(crate) async fn generate_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleGenerateReq>, AppError>,
) -> Result<Json<()>, AppError> {
    let global = state.app_config.read().await;
    enqueue_subtitle_generate(&state.taskmill, body, &global)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(()))
}

#[utoipa::path(
    post,
    path = "/api/jobs/generate/bulk",
    operation_id = "generateBulkJobs",
    tag = "jobs",
    request_body = SubtitleGenerateBulkReq,
    responses((status = 200, body = SubtitleGenerateBulkRes))
)]
pub(crate) async fn generate_bulk_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleGenerateBulkReq>, AppError>,
) -> Result<Json<SubtitleGenerateBulkRes>, AppError> {
    let global = state.app_config.read().await;
    let res = bulk_enqueue_subtitle_generate(&state.taskmill, body, &global)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(res))
}

#[utoipa::path(
    post,
    path = "/api/jobs/scan-generate",
    operation_id = "scanGenerateJobs",
    tag = "jobs",
    request_body = ScanGenerateSubtitleReq,
    responses((status = 200, body = ScanGenerateSubtitleRes))
)]
pub(crate) async fn scan_generate_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<ScanGenerateSubtitleReq>, AppError>,
) -> Result<Json<ScanGenerateSubtitleRes>, AppError> {
    let global = state.app_config.read().await;
    let res = scan_and_enqueue_subtitle_generate(&state.db, &state.taskmill, body, &global)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(res))
}

#[utoipa::path(
    post,
    path = "/api/jobs/translate",
    operation_id = "translateJobs",
    tag = "jobs",
    request_body = SubtitleTranslateJobReq,
    responses((status = 200))
)]
pub(crate) async fn translate_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTranslateJobReq>, AppError>,
) -> Result<Json<()>, AppError> {
    let global = state.app_config.read().await;
    enqueue_subtitle_translate_req(&state.taskmill, body, &global)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(()))
}

#[utoipa::path(
    get,
    path = "/api/jobs/snapshot",
    operation_id = "snapshotJobs",
    tag = "jobs",
    responses((status = 200, body = TaskmillSnapshot))
)]
pub(crate) async fn snapshot_handler(
    State(state): State<AppState>,
) -> Result<Json<TaskmillSnapshot>, AppError> {
    let snapshot = state
        .taskmill
        .snapshot()
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(snapshot))
}

#[utoipa::path(
    get,
    path = "/api/jobs/history",
    operation_id = "historyJobs",
    tag = "jobs",
    params(JobsHistoryQuery),
    responses((status = 200, body = Vec<serde_json::Value>))
)]
pub(crate) async fn history_handler(
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

#[utoipa::path(
    get,
    path = "/api/jobs/exec-log",
    operation_id = "execLogJobs",
    tag = "jobs",
    params(JobsExecLogQuery),
    responses((status = 200, body = Vec<TimestampedSchedulerEvent>))
)]
pub(crate) async fn exec_log_handler(
    State(state): State<AppState>,
    Query(q): Query<JobsExecLogQuery>,
) -> Result<Json<Vec<TimestampedSchedulerEvent>>, AppError> {
    let limit = clamp_exec_log_limit(q.limit);
    let rows = state.taskmill.recent_exec_events(limit).await;
    Ok(Json(rows))
}

#[utoipa::path(
    get,
    path = "/api/jobs/active",
    operation_id = "activeTasksJobs",
    tag = "jobs",
    params(JobsActiveQuery),
    responses((status = 200, body = Vec<serde_json::Value>))
)]
pub(crate) async fn active_tasks_handler(
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

#[utoipa::path(
    post,
    path = "/api/jobs/scheduler/pause",
    operation_id = "pauseSchedulerJobs",
    tag = "jobs",
    responses((status = 200, body = TaskmillControlOk))
)]
pub(crate) async fn scheduler_pause_handler(
    State(state): State<AppState>,
) -> Json<TaskmillControlOk> {
    state.taskmill.pause_scheduler().await;
    Json(TaskmillControlOk { ok: true })
}

#[utoipa::path(
    post,
    path = "/api/jobs/scheduler/resume",
    operation_id = "resumeSchedulerJobs",
    tag = "jobs",
    responses((status = 200, body = TaskmillControlOk))
)]
pub(crate) async fn scheduler_resume_handler(
    State(state): State<AppState>,
) -> Result<Json<TaskmillControlOk>, AppError> {
    state
        .taskmill
        .resume_scheduler()
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(TaskmillControlOk { ok: true }))
}

#[utoipa::path(
    post,
    path = "/api/jobs/tasks/{id}/cancel",
    operation_id = "cancelTaskJobs",
    tag = "jobs",
    params(("id" = i64, Path, description = "任务 ID")),
    responses((status = 200, body = TaskmillCancelRes))
)]
pub(crate) async fn task_cancel_handler(
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

#[utoipa::path(
    post,
    path = "/api/jobs/tasks/{id}/pause",
    operation_id = "pauseTaskJobs",
    tag = "jobs",
    params(("id" = i64, Path, description = "任务 ID")),
    responses((status = 200, body = TaskmillControlOk))
)]
pub(crate) async fn task_pause_handler(
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

#[utoipa::path(
    post,
    path = "/api/jobs/tasks/{id}/resume",
    operation_id = "resumeTaskJobs",
    tag = "jobs",
    params(("id" = i64, Path, description = "任务 ID")),
    responses((status = 200, body = TaskmillControlOk))
)]
pub(crate) async fn task_resume_handler(
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

#[utoipa::path(
    delete,
    path = "/api/jobs/history/{id}",
    operation_id = "deleteHistoryJobs",
    tag = "jobs",
    params(("id" = i64, Path, description = "历史记录 ID")),
    responses((status = 200, body = TaskmillDeleteHistoryRes))
)]
pub(crate) async fn delete_history_handler(
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
