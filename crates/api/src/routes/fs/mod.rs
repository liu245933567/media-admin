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
use ma_service::fs::{
    FsDeleteReq, FsDeleteRes, FsListItem, FsListReq, FsReadTextReq, FsReadTextRes,
    VideoPlaybackProbeRes, VideoTranscodeStatusRes, delete_subtitle_file, get_fs_list,
    probe_video_playback, read_text_file, resolve_transcoded_video_path, start_video_transcode,
    stream_local_video, video_transcode_status,
};
use serde::Deserialize;
use utoipa::{IntoParams, ToSchema};

pub fn routes() -> StateRouter {
    Router::new()
        .route("/list", post(list_handler))
        .route("/read-text", post(read_text_handler))
        .route("/delete-subtitle", post(delete_subtitle_handler))
        .route("/video", get(video_stream_handler))
        .route("/video/probe", get(video_probe_handler))
        .route(
            "/video/transcode/status",
            get(video_transcode_status_handler),
        )
        .route(
            "/video/transcode/start",
            post(video_transcode_start_handler),
        )
        .route("/video/transcoded", get(video_transcoded_stream_handler))
}

#[utoipa::path(
    post,
    path = "/api/fs/list",
    operation_id = "listFs",
    tag = "fs",
    request_body = FsListReq,
    responses((status = 200, body = Vec<FsListItem>))
)]
pub(crate) async fn list_handler(
    WithRejection(Json(body), _): WithRejection<Json<FsListReq>, AppError>,
) -> Result<Json<Vec<FsListItem>>, AppError> {
    let resp = get_fs_list(body.parent_path).await?;

    Ok(Json(resp))
}

#[utoipa::path(
    post,
    path = "/api/fs/read-text",
    operation_id = "readTextFs",
    tag = "fs",
    request_body = FsReadTextReq,
    responses((status = 200, body = FsReadTextRes))
)]
pub(crate) async fn read_text_handler(
    WithRejection(Json(body), _): WithRejection<Json<FsReadTextReq>, AppError>,
) -> Result<Json<FsReadTextRes>, AppError> {
    let resp = read_text_file(body.path).await?;
    Ok(Json(resp))
}

#[utoipa::path(
    post,
    path = "/api/fs/delete-subtitle",
    operation_id = "deleteSubtitleFs",
    tag = "fs",
    request_body = FsDeleteReq,
    responses((status = 200, body = FsDeleteRes))
)]
pub(crate) async fn delete_subtitle_handler(
    WithRejection(Json(body), _): WithRejection<Json<FsDeleteReq>, AppError>,
) -> Result<Json<FsDeleteRes>, AppError> {
    let resp = delete_subtitle_file(body.path)
        .await
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    Ok(Json(resp))
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub(crate) struct VideoPathQuery {
    path: String,
}

async fn video_stream_handler(
    Query(q): Query<VideoPathQuery>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let range = req_headers.get(header::RANGE).and_then(|v| v.to_str().ok());

    let streamed = stream_local_video(q.path, range)
        .await
        .map_err(map_fs_video_err)?;

    video_stream_response(streamed)
}

#[utoipa::path(
    get,
    path = "/api/fs/video/probe",
    operation_id = "probeVideoFs",
    tag = "fs",
    params(VideoPathQuery),
    responses((status = 200, body = VideoPlaybackProbeRes))
)]
pub(crate) async fn video_probe_handler(
    Query(q): Query<VideoPathQuery>,
) -> Result<Json<VideoPlaybackProbeRes>, AppError> {
    let res = probe_video_playback(q.path)
        .await
        .map_err(map_fs_video_err)?;
    Ok(Json(res))
}

#[utoipa::path(
    get,
    path = "/api/fs/video/transcode/status",
    operation_id = "videoTranscodeStatusFs",
    tag = "fs",
    params(VideoPathQuery),
    responses((status = 200, body = VideoTranscodeStatusRes))
)]
pub(crate) async fn video_transcode_status_handler(
    Query(q): Query<VideoPathQuery>,
) -> Result<Json<VideoTranscodeStatusRes>, AppError> {
    let res = video_transcode_status(q.path)
        .await
        .map_err(map_fs_video_err)?;
    Ok(Json(res))
}

#[utoipa::path(
    post,
    path = "/api/fs/video/transcode/start",
    operation_id = "startVideoTranscodeFs",
    tag = "fs",
    params(VideoPathQuery),
    responses((status = 200, body = VideoTranscodeStatusRes))
)]
pub(crate) async fn video_transcode_start_handler(
    Query(q): Query<VideoPathQuery>,
) -> Result<Json<VideoTranscodeStatusRes>, AppError> {
    let res = start_video_transcode(q.path)
        .await
        .map_err(map_fs_video_err)?;
    Ok(Json(res))
}

async fn video_transcoded_stream_handler(
    Query(q): Query<VideoPathQuery>,
    req_headers: HeaderMap,
) -> Result<Response, AppError> {
    let cache_path = resolve_transcoded_video_path(q.path).await.map_err(|e| {
        let msg = e.to_string();
        if msg.contains("尚未就绪") {
            AppError::BadRequest(msg)
        } else {
            map_fs_video_err(e)
        }
    })?;

    let range = req_headers.get(header::RANGE).and_then(|v| v.to_str().ok());
    let streamed = stream_local_video(cache_path.to_string_lossy().into_owned(), range)
        .await
        .map_err(map_fs_video_err)?;

    video_stream_response(streamed)
}

fn video_stream_response(streamed: ma_service::fs::LocalVideoStream) -> Result<Response, AppError> {
    let status = StatusCode::from_u16(streamed.status).unwrap_or(StatusCode::BAD_GATEWAY);

    let mut resp_headers = HeaderMap::new();
    for (name, value) in streamed.headers.iter() {
        resp_headers.insert(name.clone(), value.clone());
    }
    if !resp_headers.contains_key(header::ACCEPT_RANGES) {
        resp_headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    }

    let body = Body::from_stream(
        streamed
            .body
            .map(|chunk| chunk.map_err(|e| std::io::Error::other(e))),
    );

    Ok((status, resp_headers, body).into_response())
}

fn map_fs_video_err(e: anyhow::Error) -> AppError {
    let msg = e.to_string();
    if msg.contains("必须为绝对路径")
        || msg.contains("不存在")
        || msg.contains("不能为目录")
        || msg.contains("不支持的视频")
        || msg.contains("Range")
        || msg.contains("空文件")
        || msg.contains("尚未就绪")
        || msg.contains("转码缓存无效")
    {
        AppError::BadRequest(msg)
    } else if msg.contains("未找到 ffmpeg") || msg.contains("未找到 ffprobe") {
        AppError::BadRequest(msg)
    } else {
        AppError::Upstream(msg)
    }
}
