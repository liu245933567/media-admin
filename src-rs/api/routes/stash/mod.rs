use crate::{core::stash::forward_graphql, error::AppError};
use axum::{routing::post, Json, Router};
use axum_extra::extract::WithRejection;
use serde_json::Value;

use crate::api::StateRouter;

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
