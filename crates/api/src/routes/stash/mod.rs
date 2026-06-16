use crate::{AppState, StateRouter, error::AppError};
use axum::{
    Json, Router,
    body::Body,
    extract::{Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use axum_extra::extract::WithRejection;
use futures_util::StreamExt;
use ma_service::{
    SubtitleGenerateConfig,
    job::{
        SubtitleGenerateBulkFailedItem, SubtitleGenerateBulkReq, bulk_enqueue_subtitle_generate,
    },
    stash::{
        StashEntitySearchReq, StashEntitySearchRes, StashSceneListReq,
        StashSceneMetadataCompleteReq, StashSceneMetadataCompleteRes, StashSceneRow,
        complete_scene_metadata, list_mapped_video_paths_without_captions, list_scenes,
        proxy_media, search_entities,
    },
};
use ma_utils::types::PageResult;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub fn routes() -> StateRouter {
    Router::new()
        .route("/scenes/list", post(scenes_list_handler))
        .route(
            "/scenes/subtitles/generate-missing",
            post(scenes_generate_missing_subtitles_handler),
        )
        .route(
            "/scenes/metadata/complete",
            post(scenes_metadata_complete_handler),
        )
        .route("/entities/search", get(entities_search_handler))
        .route("/media", get(media_proxy_handler))
}

#[derive(Deserialize, ToSchema)]
pub struct StashSceneGenerateMissingSubtitlesReq {
    /// `None` 表示整包采用全局默认生成配置。
    pub config: Option<SubtitleGenerateConfig>,
    /// 若同 video_path 已有 pending/running 生成任务则跳过（默认 true）。
    pub skip_if_exists: Option<bool>,
}

#[derive(Serialize, ToSchema)]
pub struct StashSceneGenerateMissingSubtitlesRes {
    /// Stash 中无字幕且能映射为本地路径的视频数量。
    pub matched_videos: usize,
    pub submitted: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<SubtitleGenerateBulkFailedItem>,
}

#[utoipa::path(
    post,
    path = "/api/stash/scenes/list",
    operation_id = "listScenesStash",
    tag = "stash",
    request_body = StashSceneListReq,
    responses((status = 200, body = PageResult<StashSceneRow>))
)]
pub(crate) async fn scenes_list_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<StashSceneListReq>, AppError>,
) -> Result<Json<PageResult<StashSceneRow>>, AppError> {
    let stash_config = state.app_config.read().await.stash_config.clone();
    let res = list_scenes(&stash_config, body)
        .await
        .map_err(map_stash_err)?;
    Ok(Json(res))
}

#[utoipa::path(
    post,
    path = "/api/stash/scenes/subtitles/generate-missing",
    operation_id = "generateMissingSubtitlesStash",
    tag = "stash",
    request_body = StashSceneGenerateMissingSubtitlesReq,
    responses((status = 200, body = StashSceneGenerateMissingSubtitlesRes))
)]
pub(crate) async fn scenes_generate_missing_subtitles_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<
        Json<StashSceneGenerateMissingSubtitlesReq>,
        AppError,
    >,
) -> Result<Json<StashSceneGenerateMissingSubtitlesRes>, AppError> {
    let global = state.app_config.read().await;
    let video_paths = list_mapped_video_paths_without_captions(&global.stash_config)
        .await
        .map_err(map_stash_err)?;
    let matched_videos = video_paths.len();

    if video_paths.is_empty() {
        return Ok(Json(StashSceneGenerateMissingSubtitlesRes {
            matched_videos,
            submitted: Vec::new(),
            skipped: Vec::new(),
            failed: Vec::new(),
        }));
    }

    let res = bulk_enqueue_subtitle_generate(
        &state.taskmill,
        SubtitleGenerateBulkReq {
            video_paths,
            config: body.config,
            skip_if_exists: body.skip_if_exists,
        },
        &global,
    )
    .await
    .map_err(AppError::Internal)?;

    Ok(Json(StashSceneGenerateMissingSubtitlesRes {
        matched_videos,
        submitted: res.submitted,
        skipped: res.skipped,
        failed: res.failed,
    }))
}

#[utoipa::path(
    post,
    path = "/api/stash/scenes/metadata/complete",
    operation_id = "completeSceneMetadataStash",
    tag = "stash",
    request_body = StashSceneMetadataCompleteReq,
    responses((status = 200, body = StashSceneMetadataCompleteRes))
)]
pub(crate) async fn scenes_metadata_complete_handler(
    State(state): State<AppState>,
    WithRejection(Json(body), _): WithRejection<Json<StashSceneMetadataCompleteReq>, AppError>,
) -> Result<Json<StashSceneMetadataCompleteRes>, AppError> {
    let stash_config = state.app_config.read().await.stash_config.clone();
    let res = complete_scene_metadata(&stash_config, body)
        .await
        .map_err(map_stash_err)?;
    Ok(Json(res))
}

#[utoipa::path(
    get,
    path = "/api/stash/entities/search",
    operation_id = "searchEntitiesStash",
    tag = "stash",
    params(StashEntitySearchReq),
    responses((status = 200, body = StashEntitySearchRes))
)]
pub(crate) async fn entities_search_handler(
    State(state): State<AppState>,
    Query(q): Query<StashEntitySearchReq>,
) -> Result<Json<StashEntitySearchRes>, AppError> {
    let stash_config = state.app_config.read().await.stash_config.clone();
    let res = search_entities(&stash_config, q)
        .await
        .map_err(map_stash_err)?;
    Ok(Json(res))
}

#[derive(Deserialize, ToSchema)]
struct MediaQuery {
    path: String,
}

async fn media_proxy_handler(
    State(state): State<AppState>,
    Query(q): Query<MediaQuery>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let range = req_headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let stash_config = state.app_config.read().await.stash_config.clone();

    let proxied = proxy_media(&stash_config, &q.path, range)
        .await
        .map_err(map_stash_err)?;

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

fn map_stash_err(e: anyhow::Error) -> AppError {
    let msg = e.to_string();
    if msg.contains("未配置 Stash") {
        AppError::BadRequest(msg)
    } else {
        AppError::Upstream(msg)
    }
}
