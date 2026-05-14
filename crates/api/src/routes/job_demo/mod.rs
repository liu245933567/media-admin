use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use axum_extra::extract::WithRejection;
use ma_service::job::{
    TaskmillDemoSnapshot, TranslateSubtitleOnlyInput, VideoSubtitlePipelineInput,
};

use crate::{AppState, StateRouter, error::AppError};

pub fn routes() -> StateRouter {
    Router::new()
        .route("/pipeline", post(pipeline_handler))
        .route("/translate-subtitle", post(translate_handler))
        .route("/snapshot", get(snapshot_handler))
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
