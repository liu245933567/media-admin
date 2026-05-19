use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use axum_extra::extract::WithRejection;
use ma_service::setup_download::{
    DownloadJobStartRes, FfmpegDownloadStartReq, FfmpegSetupStatusRes, WhisperDownloadStartReq,
    WhisperModelsListRes, ffmpeg_setup_status, list_whisper_models, start_ffmpeg_setup_download,
    start_whisper_model_download,
};

use crate::{AppState, StateRouter, error::AppError};

pub fn routes() -> StateRouter {
    Router::new()
        .route("/whisper/models", get(list_whisper_models_handler))
        .route("/whisper/download", post(whisper_download_handler))
        .route("/ffmpeg/status", get(ffmpeg_status_handler))
        .route("/ffmpeg/download", post(ffmpeg_download_handler))
}

async fn list_whisper_models_handler() -> Json<WhisperModelsListRes> {
    Json(list_whisper_models())
}

async fn ffmpeg_status_handler() -> Json<FfmpegSetupStatusRes> {
    Json(ffmpeg_setup_status())
}

async fn whisper_download_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<WhisperDownloadStartReq>, AppError>,
) -> Result<Json<DownloadJobStartRes>, AppError> {
    let task_id = start_whisper_model_download(&state.taskmill, body)
        .await
        .map_err(map_setup_download_error)?;
    Ok(Json(DownloadJobStartRes {
        job_id: task_id.to_string(),
    }))
}

async fn ffmpeg_download_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<FfmpegDownloadStartReq>, AppError>,
) -> Result<Json<DownloadJobStartRes>, AppError> {
    let _ = body;
    let task_id = start_ffmpeg_setup_download(&state.taskmill)
        .await
        .map_err(map_setup_download_error)?;
    Ok(Json(DownloadJobStartRes {
        job_id: task_id.to_string(),
    }))
}

fn map_setup_download_error(e: anyhow::Error) -> AppError {
    let s = e.to_string();
    if s.contains("whisper_download_blocked:already_present") {
        AppError::BadRequest("该模型已在本地就绪，无需下载".into())
    } else if s.contains("ffmpeg_download_blocked:already_present") {
        AppError::BadRequest("FFmpeg 已在本地就绪，无需下载".into())
    } else if s.contains("setup_download_blocked:duplicate") {
        AppError::BadRequest("下载任务已在队列或执行中".into())
    } else if s.starts_with("未知模型 id:") {
        AppError::BadRequest(s)
    } else {
        AppError::Internal(e)
    }
}
