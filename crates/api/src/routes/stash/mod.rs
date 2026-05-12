use crate::{StateRouter, error::AppError};
use axum::{Json, Router, routing::post};
use axum_extra::extract::WithRejection;
use ma_service::stash::forward_graphql;
use serde_json::Value;

pub fn routes() -> StateRouter {
    Router::new().route("/graphql", post(graphql_proxy_handler))
}

async fn graphql_proxy_handler(
    WithRejection(Json(body), _): WithRejection<Json<Value>, AppError>,
) -> Result<Json<Value>, AppError> {
    let text = forward_graphql(body)
        .await
        .map_err(|e| AppError::Upstream(e.to_string()))?;
    let v: Value = serde_json::from_str(&text)
        .map_err(|e| AppError::Upstream(format!("stash 返回非 JSON: {e}")))?;
    Ok(Json(v))
}
