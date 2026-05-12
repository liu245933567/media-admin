use crate::{AppState, StateRouter, error::AppError};
use ma_service::subtitle_task::{
    SubtitleTaskQueuePauseReq, SubtitleTaskQueuePauseRes, SubtitleTaskQueueResumeRes,
    SubtitleTaskQueueStatusReq, SubtitleTaskQueueStatusRes, bulk_create_subtitle_tasks,
    create_subtitle_task, default_subtitle_generate_config, delete_subtitle_task, list_subtitle_tasks,
    pause_subtitle_task_queue, resume_subtitle_task_queue,
};

use axum::{Json, Router, extract::State, routing::{get, post}};
use axum_extra::extract::WithRejection;
use ma_service::subtitle_task::types::{
    SubtitleTaskBulkCreateReq, SubtitleTaskBulkCreateRes, SubtitleTaskCreateReq,
    SubtitleTaskDeleteReq, SubtitleTaskDeleteRes, SubtitleTaskGenerateDefaultsRes, SubtitleTaskItem,
    SubtitleTaskListReq, SubtitleTaskListRes, SubtitleTaskQueueResumeReq,
};
pub fn routes() -> StateRouter {
    Router::new()
        .route("/generate-defaults", get(generate_defaults_handler))
        .route("/tasks/list", post(list_handler))
        .route("/tasks", post(create_handler))
        .route("/tasks/bulk", post(bulk_create_handler))
        .route("/tasks/delete", post(delete_handler))
        .route("/queue/pause", post(queue_pause_handler))
        .route("/queue/resume", post(queue_resume_handler))
        .route("/queue/status", post(queue_status_handler))
}

async fn generate_defaults_handler() -> Json<SubtitleTaskGenerateDefaultsRes> {
    Json(default_subtitle_generate_config())
}

async fn create_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTaskCreateReq>, AppError>,
) -> Result<Json<SubtitleTaskItem>, AppError> {
    let row = create_subtitle_task(&state.db, body)
        .await
        .map_err(AppError::Internal)?;
    state.subtitle_task_queue.enqueue();
    Ok(Json(row))
}

async fn bulk_create_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTaskBulkCreateReq>, AppError>,
) -> Result<Json<SubtitleTaskBulkCreateRes>, AppError> {
    let res = bulk_create_subtitle_tasks(&state.db, body)
        .await
        .map_err(AppError::Internal)?;

    if !res.created.is_empty() {
        // 只需要唤醒一次 worker
        state.subtitle_task_queue.enqueue();
    }

    Ok(Json(res))
}

async fn list_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTaskListReq>, AppError>,
) -> Result<Json<SubtitleTaskListRes>, AppError> {
    let page = list_subtitle_tasks(&state.db, &body)
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

async fn queue_pause_handler(
    State(state): State<AppState>,
    WithRejection(Json(_body), _): WithRejection<Json<SubtitleTaskQueuePauseReq>, AppError>,
) -> Result<Json<SubtitleTaskQueuePauseRes>, AppError> {
    // 队列整体暂停：不再 claim 新任务；若当前有 RUNNING 任务，等待其完成后进入已暂停
    state.subtitle_task_queue.request_pause();

    let res = pause_subtitle_task_queue(&state.db)
        .await
        .map_err(AppError::Internal)?;

    Ok(Json(res))
}

async fn queue_resume_handler(
    State(state): State<AppState>,
    WithRejection(Json(_body), _): WithRejection<Json<SubtitleTaskQueueResumeReq>, AppError>,
) -> Result<Json<SubtitleTaskQueueResumeRes>, AppError> {
    state.subtitle_task_queue.resume();

    let res = resume_subtitle_task_queue(&state.db)
        .await
        .map_err(AppError::Internal)?;

    // 立即唤醒 worker 去 claim 新任务
    state.subtitle_task_queue.enqueue();

    Ok(Json(res))
}

async fn queue_status_handler(
    State(state): State<AppState>,
    WithRejection(Json(_body), _): WithRejection<Json<SubtitleTaskQueueStatusReq>, AppError>,
) -> Result<Json<SubtitleTaskQueueStatusRes>, AppError> {
    Ok(Json(SubtitleTaskQueueStatusRes {
        status: state.subtitle_task_queue.status().to_string(),
    }))
}
