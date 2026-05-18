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
use ma_service::stash::{StashSceneListReq, StashSceneRow, list_scenes, proxy_media};
use ma_utils::types::PageResult;
use serde::Deserialize;

pub fn routes() -> StateRouter {
    Router::new()
        .route("/scenes/list", post(scenes_list_handler))
        .route("/media", get(media_proxy_handler))
}

async fn scenes_list_handler(
    WithRejection(Json(body), _): WithRejection<Json<StashSceneListReq>, AppError>,
) -> Result<Json<PageResult<StashSceneRow>>, AppError> {
    let res = list_scenes(body)
        .await
        .map_err(|e| AppError::Upstream(e.to_string()))?;
    Ok(Json(res))
}

#[derive(Deserialize)]
struct MediaQuery {
    path: String,
}

async fn media_proxy_handler(
    Query(q): Query<MediaQuery>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let range = req_headers.get(header::RANGE).and_then(|v| v.to_str().ok());

    let proxied = proxy_media(&q.path, range)
        .await
        .map_err(|e| AppError::Upstream(e.to_string()))?;

    let mut resp_headers = HeaderMap::new();
    for (name, value) in proxied.headers.iter() {
        resp_headers.insert(name.clone(), value.clone());
    }

    if !resp_headers.contains_key(header::ACCEPT_RANGES) {
        resp_headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    }

    let status = StatusCode::from_u16(proxied.status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);

    let body = Body::from_stream(
        proxied
            .body
            .map(|chunk| chunk.map_err(|e| std::io::Error::other(e))),
    );

    Ok((status, resp_headers, body).into_response())
}
