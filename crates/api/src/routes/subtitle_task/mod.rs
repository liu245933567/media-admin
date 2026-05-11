use crate::{
    core::subtitle_task::{
        create_subtitle_task, delete_subtitle_task, list_subtitle_tasks, pause_subtitle_task_queue,
        resume_subtitle_task_queue, SubtitleTaskCreateDbReq, SubtitleTaskCreateReq,
        SubtitleTaskCreateRes, SubtitleTaskDeleteReq, SubtitleTaskDeleteRes, SubtitleTaskListReq,
        SubtitleTaskListRes, SubtitleTaskQueuePauseReq, SubtitleTaskQueuePauseRes,
        SubtitleTaskQueueResumeReq, SubtitleTaskQueueResumeRes, SubtitleTaskQueueStatusReq,
        SubtitleTaskQueueStatusRes,
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
        .route("/queue/pause", post(queue_pause_handler))
        .route("/queue/resume", post(queue_resume_handler))
        .route("/queue/status", post(queue_status_handler))
}

async fn create_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<SubtitleTaskCreateReq>, AppError>,
) -> Result<Json<SubtitleTaskCreateRes>, AppError> {
    let SubtitleTaskCreateReq { config } = body;
    let config_json = serde_json::to_string(&config).map_err(|e| AppError::Internal(e.into()))?;
    let row = create_subtitle_task(
        &state.db,
        SubtitleTaskCreateDbReq {
            video_path: config.video_path.clone(),
            config_json,
        },
    )
    .await
    .map_err(AppError::Internal)?;
    state.subtitle_task_queue.enqueue();
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
