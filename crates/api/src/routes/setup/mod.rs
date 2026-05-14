use std::convert::Infallible;
use std::time::Duration;

use axum::{
    Json, Router,
    extract::{Path, State},
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
};
use axum_extra::extract::WithRejection;
use futures::Stream;
use ma_service::setup_download::{
    DownloadJobStartRes, FfmpegDownloadStartReq, FfmpegSetupStatusRes, SetupDownloadState,
    WhisperDownloadStartReq, WhisperModelsListRes, parse_job_id,
};
use tokio_stream::StreamExt;
use tokio_stream::wrappers::WatchStream;

use crate::{AppState, StateRouter, error::AppError};

pub fn routes() -> StateRouter {
    Router::new()
        .route("/whisper/models", get(list_whisper_models_handler))
        .route("/whisper/download", post(whisper_download_handler))
        .route("/ffmpeg/status", get(ffmpeg_status_handler))
        .route("/ffmpeg/download", post(ffmpeg_download_handler))
        .route(
            "/download-jobs/{job_id}/stream",
            get(download_job_stream_handler),
        )
}

async fn list_whisper_models_handler() -> Json<WhisperModelsListRes> {
    Json(SetupDownloadState::list_whisper_models())
}

async fn ffmpeg_status_handler() -> Json<FfmpegSetupStatusRes> {
    Json(SetupDownloadState::ffmpeg_setup_status())
}

async fn whisper_download_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<WhisperDownloadStartReq>, AppError>,
) -> Result<Json<DownloadJobStartRes>, AppError> {
    let res = state
        .setup_download
        .start_whisper_download(body)
        .await
        .map_err(|e| {
            let s = e.to_string();
            if s.contains("whisper_download_blocked:already_present") {
                AppError::BadRequest("该模型已在本地就绪，无需下载".into())
            } else if s.starts_with("未知模型 id:") {
                AppError::BadRequest(s)
            } else {
                AppError::Internal(e)
            }
        })?;
    Ok(Json(res))
}

async fn ffmpeg_download_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<FfmpegDownloadStartReq>, AppError>,
) -> Result<Json<DownloadJobStartRes>, AppError> {
    let res = state
        .setup_download
        .start_ffmpeg_download(body)
        .await
        .map_err(|e| {
            let s = e.to_string();
            if s.contains("ffmpeg_download_blocked:already_present") {
                AppError::BadRequest("FFmpeg 已在本地就绪，无需下载".into())
            } else {
                AppError::Internal(e)
            }
        })?;
    Ok(Json(res))
}

async fn download_job_stream_handler(
    State(state): State<AppState>,
    Path(job_id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    let id = parse_job_id(&job_id).map_err(|e| AppError::BadRequest(e.to_string()))?;
    let rx = state
        .setup_download
        .subscribe_job(id)
        .await
        .ok_or_else(|| AppError::NotFound("下载任务不存在或已过期".into()))?;

    let stream = WatchStream::new(rx).map(|progress| {
        let data = serde_json::to_string(&progress).unwrap_or_else(|_| "{}".into());
        Ok(Event::default().event("progress").data(data))
    });

    Ok(Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(20))
            .text("keep-alive"),
    ))
}
