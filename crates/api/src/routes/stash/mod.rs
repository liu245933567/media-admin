use crate::{StateRouter, error::AppError};
use axum::{
    Json, Router,
    extract::Query,
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{get, post},
};
use axum_extra::extract::WithRejection;
use ma_service::stash::{forward_graphql, proxy_media};
use serde::Deserialize;
use serde_json::Value;

pub fn routes() -> StateRouter {
    Router::new()
        .route("/graphql", post(graphql_proxy_handler))
        .route("/media", get(media_proxy_handler))
}

#[derive(Deserialize)]
struct MediaQuery {
    path: String,
}

async fn media_proxy_handler(Query(q): Query<MediaQuery>) -> Result<impl IntoResponse, AppError> {
    let (headers, bytes, content_type) = proxy_media(&q.path)
        .await
        .map_err(|e| AppError::Upstream(e.to_string()))?;

    let mut resp_headers = HeaderMap::new();
    resp_headers.insert("content-type", content_type.parse().unwrap());
    // 转发缓存相关头
    if let Some(v) = headers.get("cache-control") {
        resp_headers.insert("cache-control", v.clone());
    }

    Ok((StatusCode::OK, resp_headers, bytes))
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
