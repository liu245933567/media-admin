use crate::{AppState, StateRouter, error::AppError};
use axum::{
    Json, Router,
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use futures_util::StreamExt;
use ma_service::emby::{
    EmbyConnectionStatus, EmbyItemsQuery, EmbyItemsRes, EmbyLibraryItem, EmbySectionsQuery,
    EmbySectionsRes, EmbyStreamQuery, get_item, list_items, list_sections, proxy_image,
    proxy_stream, proxy_transcoded_stream, test_connection,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

pub fn routes() -> StateRouter {
    Router::new()
        .route("/connection/test", post(test_connection_handler))
        .route("/sections", get(list_sections_handler))
        .route("/items", get(list_items_handler))
        .route("/items/{id}", get(get_item_handler))
        .route("/items/{id}/image", get(image_proxy_handler))
        .route("/stream", get(stream_proxy_handler))
        .route("/transcode", get(transcode_proxy_handler))
}

#[utoipa::path(
    post,
    path = "/api/emby/connection/test",
    operation_id = "testConnectionEmby",
    tag = "emby",
    responses((status = 200, body = EmbyConnectionStatus))
)]
pub(crate) async fn test_connection_handler(
    State(state): State<AppState>,
) -> Result<Json<EmbyConnectionStatus>, AppError> {
    let cfg = state.app_config.read().await.emby_config.clone();
    let status = test_connection(&cfg).await.map_err(map_emby_err)?;
    Ok(Json(status))
}

#[utoipa::path(
    get,
    path = "/api/emby/sections",
    operation_id = "listSectionsEmby",
    tag = "emby",
    params(EmbySectionsQuery),
    responses((status = 200, body = EmbySectionsRes))
)]
pub(crate) async fn list_sections_handler(
    State(state): State<AppState>,
    Query(q): Query<EmbySectionsQuery>,
) -> Result<Json<EmbySectionsRes>, AppError> {
    let cfg = state.app_config.read().await.emby_config.clone();
    let res = list_sections(&cfg, q).await.map_err(map_emby_err)?;
    Ok(Json(res))
}

#[utoipa::path(
    get,
    path = "/api/emby/items",
    operation_id = "listItemsEmby",
    tag = "emby",
    params(EmbyItemsApiQuery),
    responses((status = 200, body = EmbyItemsRes))
)]
pub(crate) async fn list_items_handler(
    State(state): State<AppState>,
    Query(q): Query<EmbyItemsApiQuery>,
) -> Result<Json<EmbyItemsRes>, AppError> {
    let cfg = state.app_config.read().await.emby_config.clone();
    let res = list_items(&cfg, q.into_service_query())
        .await
        .map_err(map_emby_err)?;
    Ok(Json(res))
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub(crate) struct EmbyItemsApiQuery {
    #[serde(default)]
    q: Option<String>,
    #[serde(default)]
    parent_id: Option<String>,
    #[serde(default)]
    include_item_types: Option<String>,
    #[serde(default)]
    recursive: Option<bool>,
    #[serde(default = "default_start_index")]
    start_index: i32,
    #[serde(default = "default_limit")]
    limit: i32,
}

impl EmbyItemsApiQuery {
    fn into_service_query(self) -> EmbyItemsQuery {
        EmbyItemsQuery {
            q: self.q,
            parent_id: self.parent_id,
            include_item_types: self.include_item_types,
            recursive: self.recursive,
            start_index: self.start_index,
            limit: self.limit,
        }
    }
}

fn default_start_index() -> i32 {
    0
}

fn default_limit() -> i32 {
    50
}

#[utoipa::path(
    get,
    path = "/api/emby/items/{id}",
    operation_id = "getItemEmby",
    tag = "emby",
    params(("id" = String, Path, description = "Emby Item ID")),
    responses((status = 200, body = EmbyLibraryItem))
)]
pub(crate) async fn get_item_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<EmbyLibraryItem>, AppError> {
    let cfg = state.app_config.read().await.emby_config.clone();
    let item = get_item(&cfg, &id).await.map_err(map_emby_err)?;
    Ok(Json(item))
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub(crate) struct EmbyImageQuery {
    #[serde(default)]
    tag: Option<String>,
    #[serde(default)]
    image_type: Option<String>,
}

async fn image_proxy_handler(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(q): Query<EmbyImageQuery>,
) -> Result<Response, AppError> {
    let cfg = state.app_config.read().await.emby_config.clone();
    let proxied = proxy_image(&cfg, &id, q.tag.as_deref(), q.image_type.as_deref())
        .await
        .map_err(map_emby_err)?;
    emby_stream_response(proxied, true)
}

async fn stream_proxy_handler(
    State(state): State<AppState>,
    Query(q): Query<EmbyStreamQuery>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let range = req_headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let cfg = state.app_config.read().await.emby_config.clone();
    let proxied = proxy_stream(&cfg, &q.item_id, range)
        .await
        .map_err(map_emby_err)?;
    emby_stream_response(proxied, true)
}

async fn transcode_proxy_handler(
    State(state): State<AppState>,
    Query(q): Query<EmbyStreamQuery>,
) -> Result<Response, AppError> {
    let cfg = state.app_config.read().await.emby_config.clone();
    let proxied = proxy_transcoded_stream(&cfg, &q.item_id)
        .await
        .map_err(map_emby_err)?;
    emby_stream_response(proxied, false)
}

fn emby_stream_response(
    streamed: ma_service::emby::ProxiedEmbyMedia,
    advertise_accept_ranges: bool,
) -> Result<Response, AppError> {
    let status = StatusCode::from_u16(streamed.status.as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);

    let mut resp_headers = HeaderMap::new();
    for (name, value) in streamed.headers.iter() {
        resp_headers.insert(name.clone(), value.clone());
    }
    if advertise_accept_ranges && !resp_headers.contains_key(header::ACCEPT_RANGES) {
        resp_headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    }

    let body = Body::from_stream(
        streamed
            .body
            .map(|chunk| chunk.map_err(|e| std::io::Error::other(e))),
    );

    Ok((status, resp_headers, body).into_response())
}

fn map_emby_err(e: anyhow::Error) -> AppError {
    let msg = e.to_string();
    if msg.contains("未配置 Emby")
        || msg.contains("请填写 Emby")
        || msg.contains("需要配置用户 ID")
        || msg.contains("需要配置用户名或用户 ID")
        || msg.contains("未在 Emby 中找到用户")
        || msg.contains("Unrecognized Guid format")
    {
        AppError::BadRequest(msg)
    } else {
        AppError::Upstream(msg)
    }
}
