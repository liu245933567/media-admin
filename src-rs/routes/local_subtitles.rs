use crate::error::AppError;
use crate::generation_job::{self, JobResponse};
use crate::local_pipeline;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::Json;
use serde::Deserialize;
use std::path::PathBuf;
use tracing::instrument;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct CreateJobBody {
    pub video_path: String,
}

#[derive(serde::Serialize)]
pub struct CreateJobResponse {
    pub job_id: String,
    pub reused: bool,
}

#[derive(Debug, Deserialize)]
pub struct ListJobsQuery {
    pub status: Option<String>,
    pub limit: Option<i64>,
}

#[instrument(skip(state), fields(video_path = body.video_path.as_str()))]
pub async fn create_local_job(
    State(state): State<AppState>,
    Json(body): Json<CreateJobBody>,
) -> Result<Json<CreateJobResponse>, AppError> {
    let path = PathBuf::from(body.video_path.trim());
    if path.as_os_str().is_empty() {
        return Err(AppError::BadRequest("video_path 不能为空".into()));
    }
    if !path.is_absolute() {
        return Err(AppError::BadRequest(
            "video_path 必须为后端可访问的绝对路径".into(),
        ));
    }
    if !tokio::fs::try_exists(&path)
        .await
        .map_err(|e| AppError::Internal(e.into()))?
    {
        return Err(AppError::NotFound(format!(
            "找不到视频文件: {}",
            path.display()
        )));
    }
    let meta = tokio::fs::metadata(&path)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;
    if !meta.is_file() {
        return Err(AppError::BadRequest("路径必须是视频文件".into()));
    }

    let video_str = path.display().to_string();
    if let Some(row) = generation_job::find_running_job_for_video(&state.pool, &video_str)
        .await
        .map_err(|e| AppError::Internal(e.into()))?
    {
        return Ok(Json(CreateJobResponse {
            job_id: row.id,
            reused: true,
        }));
    }

    let id = Uuid::new_v4().to_string();
    let detail = generation_job::JobDetail {
        bytes_downloaded: None,
        total_bytes: None,
        current_segment: None,
        total_segments: None,
        video_path: Some(video_str.clone()),
        subtitle_path: None,
        whisper_logs: None,
    };
    generation_job::insert_job(&state.pool, &id, &video_str, &detail)
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    let pool = state.pool.clone();
    let config = state.config.clone();
    let lock = state.model_download_lock.clone();
    let p = path.clone();
    let job_id_response = id.clone();
    tokio::spawn(async move {
        local_pipeline::run_local_generation_job(pool, config, id, p, lock).await;
    });

    Ok(Json(CreateJobResponse {
        job_id: job_id_response,
        reused: false,
    }))
}

#[instrument(skip(state))]
pub async fn get_local_job(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<JobResponse>, AppError> {
    let row = generation_job::get_job(&state.pool, &id)
        .await
        .map_err(|e| AppError::Internal(e.into()))?
        .ok_or_else(|| AppError::NotFound("任务不存在".into()))?;
    Ok(Json(generation_job::row_to_response(row)))
}

#[instrument(skip(state))]
pub async fn list_local_jobs(
    State(state): State<AppState>,
    Query(q): Query<ListJobsQuery>,
) -> Result<Json<Vec<JobResponse>>, AppError> {
    let limit = q.limit.unwrap_or(20);
    let rows = generation_job::list_jobs(
        &state.pool,
        q.status.as_deref(),
        limit,
    )
    .await
    .map_err(|e| AppError::Internal(e.into()))?;
    let out: Vec<JobResponse> = rows
        .into_iter()
        .map(generation_job::row_to_response)
        .collect();
    Ok(Json(out))
}
