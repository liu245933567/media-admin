use axum::{
    Json, Router,
    extract::State,
    routing::{get, put},
};
use axum_extra::extract::WithRejection;
use ma_service::{AppConfig, merge_app_config_on_put_translate_api_key};

use crate::{AppState, StateRouter, app_config_store, error::AppError};

pub fn routes() -> StateRouter {
    Router::new()
        .route("/app-config", get(get_app_config))
        .route("/app-config", put(put_app_config))
}

/// 返回当前全局配置。
async fn get_app_config(State(state): State<AppState>) -> Result<Json<AppConfig>, AppError> {
    let c = state.app_config.read().await.clone();
    Ok(Json(c))
}

/// 更新全局配置并持久化；`api_key` 为空则保留原密钥。
async fn put_app_config(
    State(state): State<AppState>,
    WithRejection(Json(incoming), _): WithRejection<Json<AppConfig>, AppError>,
) -> Result<Json<AppConfig>, AppError> {
    let previous = state.app_config.read().await.clone();
    let merged = merge_app_config_on_put_translate_api_key(&previous, incoming);
    app_config_store::persist_app_config(&merged).await?;
    *state.app_config.write().await = merged.clone();
    Ok(Json(merged))
}
