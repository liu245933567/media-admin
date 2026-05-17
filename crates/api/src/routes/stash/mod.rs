use crate::{StateRouter, error::AppError};
use axum::{
    Json, Router,
    body::Body,
    extract::Query,
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use axum_extra::extract::WithRejection;
use futures_util::StreamExt;
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

async fn media_proxy_handler(
    Query(q): Query<MediaQuery>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let range = req_headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok());

    let proxied = proxy_media(&q.path, range)
        .await
        .map_err(|e| AppError::Upstream(e.to_string()))?;

    let mut resp_headers = HeaderMap::new();
    for (name, value) in proxied.headers.iter() {
        resp_headers.insert(name.clone(), value.clone());
    }

    if !resp_headers.contains_key(header::ACCEPT_RANGES) {
        resp_headers.insert(
            header::ACCEPT_RANGES,
            HeaderValue::from_static("bytes"),
        );
    }

    let status = StatusCode::from_u16(proxied.status.as_u16())
        .unwrap_or(StatusCode::BAD_GATEWAY);

    let body = Body::from_stream(proxied.body.map(|chunk| {
        chunk.map_err(|e| std::io::Error::other(e))
    }));

    Ok((status, resp_headers, body).into_response())
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
