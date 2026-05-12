use crate::{AppState, StateRouter, error::AppError};
use axum::{Json, Router, extract::State, routing::post};
use axum_extra::extract::WithRejection;
use ma_service::subtitle_translate_task::{
    SubtitleTranslateTaskQueuePauseReq, SubtitleTranslateTaskQueuePauseRes,
    SubtitleTranslateTaskQueueResumeRes, SubtitleTranslateTaskQueueStatusReq,
    SubtitleTranslateTaskQueueStatusRes, create_subtitle_translate_task,
    delete_subtitle_translate_task, list_subtitle_translate_tasks,
    pause_subtitle_translate_task_queue, resume_subtitle_translate_task_queue,
    retry_subtitle_translate_task,
};
use ma_service::subtitle_translate_task::types::{
    SubtitleTranslateTaskCreateReq, SubtitleTranslateTaskDeleteReq, SubtitleTranslateTaskDeleteRes,
    SubtitleTranslateTaskItem, SubtitleTranslateTaskListReq, SubtitleTranslateTaskListRes,
    SubtitleTranslateTaskQueueResumeReq, SubtitleTranslateTaskRetryReq, SubtitleTranslateTaskRetryRes,
};

pub fn routes() -> StateRouter {
    Router::new()
        .route("/tasks/list", post(list_handler))
        .route("/tasks", post(create_handler))
        .route("/tasks/delete", post(delete_handler))
        .route("/tasks/retry", post(retry_handler))
        .route("/queue/pause", post(queue_pause_handler))
        .route("/queue/resume", post(queue_resume_handler))
        .route("/queue/status", post(queue_status_handler))
}

async fn create_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTranslateTaskCreateReq>, AppError>,
) -> Result<Json<SubtitleTranslateTaskItem>, AppError> {
    let row = create_subtitle_translate_task(&state.db, body)
        .await
        .map_err(AppError::Internal)?;
    state.subtitle_translate_task_queue.enqueue();
    Ok(Json(row))
}

async fn list_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTranslateTaskListReq>, AppError>,
) -> Result<Json<SubtitleTranslateTaskListRes>, AppError> {
    let page = list_subtitle_translate_tasks(&state.db, &body)
        .await
        .map_err(AppError::Internal)?;
    Ok(Json(page))
}

async fn delete_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTranslateTaskDeleteReq>, AppError>,
) -> Result<Json<SubtitleTranslateTaskDeleteRes>, AppError> {
    delete_subtitle_translate_task(&state.db, body.task_id)
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

async fn retry_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTranslateTaskRetryReq>, AppError>,
) -> Result<Json<SubtitleTranslateTaskRetryRes>, AppError> {
    retry_subtitle_translate_task(&state.db, body.task_id)
        .await
        .map_err(|e| {
            let m = e.to_string();
            if m == "任务不存在" || m == "仅失败任务可重新开始" {
                AppError::BadRequest(m)
            } else {
                AppError::Internal(e)
            }
        })
        .map(|res| {
            state.subtitle_translate_task_queue.enqueue();
            Json(res)
        })
}

async fn queue_pause_handler(
    State(state): State<AppState>,
    WithRejection(Json(_body), _): WithRejection<Json<SubtitleTranslateTaskQueuePauseReq>, AppError>,
) -> Result<Json<SubtitleTranslateTaskQueuePauseRes>, AppError> {
    state.subtitle_translate_task_queue.request_pause();

    let res = pause_subtitle_translate_task_queue(&state.db)
        .await
        .map_err(AppError::Internal)?;

    Ok(Json(res))
}

async fn queue_resume_handler(
    State(state): State<AppState>,
    WithRejection(Json(_body), _): WithRejection<Json<SubtitleTranslateTaskQueueResumeReq>, AppError>,
) -> Result<Json<SubtitleTranslateTaskQueueResumeRes>, AppError> {
    state.subtitle_translate_task_queue.resume();

    let res = resume_subtitle_translate_task_queue(&state.db)
        .await
        .map_err(AppError::Internal)?;

    state.subtitle_translate_task_queue.enqueue();

    Ok(Json(res))
}

async fn queue_status_handler(
    State(state): State<AppState>,
    WithRejection(Json(_body), _): WithRejection<Json<SubtitleTranslateTaskQueueStatusReq>, AppError>,
) -> Result<Json<SubtitleTranslateTaskQueueStatusRes>, AppError> {
    Ok(Json(SubtitleTranslateTaskQueueStatusRes {
        status: state.subtitle_translate_task_queue.status().to_string(),
    }))
}
