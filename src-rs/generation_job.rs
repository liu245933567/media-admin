use anyhow::Context;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct JobDetail {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bytes_downloaded: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_segment: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_segments: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle_path: Option<String>,
    /// Whisper 转写过程中的逐段日志（前端轮询展示）。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub whisper_logs: Option<Vec<String>>,
}

pub async fn insert_job(
    pool: &SqlitePool,
    id: &str,
    video_path: &str,
    detail: &JobDetail,
) -> anyhow::Result<()> {
    let detail_json = serde_json::to_string(detail)?;
    sqlx::query(
        r#"INSERT INTO subtitle_generation_jobs
           (id, status, phase, progress, message, detail_json, video_path)
           VALUES (?, 'running', 'ensure_model', 0, '任务已创建', ?, ?)"#,
    )
    .bind(id)
    .bind(&detail_json)
    .bind(video_path)
    .execute(pool)
    .await
    .context("插入字幕生成任务")?;
    Ok(())
}

pub async fn update_job_progress(
    pool: &SqlitePool,
    id: &str,
    phase: &str,
    progress: f64,
    message: &str,
    detail: Option<&JobDetail>,
) -> anyhow::Result<()> {
    let detail_json = match detail {
        Some(d) => Some(serde_json::to_string(d)?),
        None => None,
    };
    sqlx::query(
        r#"UPDATE subtitle_generation_jobs SET
            phase = ?, progress = ?, message = ?,
            detail_json = COALESCE(?, detail_json),
            updated_at = datetime('now')
           WHERE id = ?"#,
    )
    .bind(phase)
    .bind(progress)
    .bind(message)
    .bind(&detail_json)
    .bind(id)
    .execute(pool)
    .await
    .context("更新任务进度")?;
    Ok(())
}

pub async fn set_job_succeeded(
    pool: &SqlitePool,
    id: &str,
    message: &str,
    detail: &JobDetail,
) -> anyhow::Result<()> {
    let detail_json = serde_json::to_string(detail)?;
    sqlx::query(
        r#"UPDATE subtitle_generation_jobs SET
            phase = 'write_file', progress = 100, message = ?,
            detail_json = ?, status = 'succeeded', error = NULL, updated_at = datetime('now')
           WHERE id = ?"#,
    )
    .bind(message)
    .bind(&detail_json)
    .bind(id)
    .execute(pool)
    .await
    .context("标记任务成功")?;
    Ok(())
}

pub async fn set_job_failed(
    pool: &SqlitePool,
    id: &str,
    phase: &str,
    message: &str,
    err: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"UPDATE subtitle_generation_jobs SET
            phase = ?, progress = 0, message = ?,
            status = 'failed', error = ?, updated_at = datetime('now')
           WHERE id = ?"#,
    )
    .bind(phase)
    .bind(message)
    .bind(err)
    .bind(id)
    .execute(pool)
    .await
    .context("标记任务失败")?;
    Ok(())
}

pub async fn set_subtitle_path(pool: &SqlitePool, id: &str, path: &str) -> anyhow::Result<()> {
    sqlx::query(
        r#"UPDATE subtitle_generation_jobs SET subtitle_path = ?, updated_at = datetime('now') WHERE id = ?"#,
    )
    .bind(path)
    .bind(id)
    .execute(pool)
    .await
    .context("更新字幕路径")?;
    Ok(())
}

#[derive(Debug, sqlx::FromRow)]
pub struct JobRow {
    pub id: String,
    pub status: String,
    pub phase: String,
    pub progress: f64,
    pub message: String,
    pub detail_json: Option<String>,
    pub video_path: Option<String>,
    pub subtitle_path: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn get_job(pool: &SqlitePool, id: &str) -> anyhow::Result<Option<JobRow>> {
    let row = sqlx::query_as::<_, JobRow>(
        r#"SELECT id, status, phase, progress, message, detail_json, video_path, subtitle_path, error, created_at, updated_at
           FROM subtitle_generation_jobs WHERE id = ?"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .context("查询单个生成任务")?;
    Ok(row)
}

pub async fn list_jobs(
    pool: &SqlitePool,
    status_filter: Option<&str>,
    limit: i64,
) -> anyhow::Result<Vec<JobRow>> {
    let lim = limit.clamp(1, 100);
    let rows = if let Some(st) = status_filter {
        sqlx::query_as::<_, JobRow>(
            r#"SELECT id, status, phase, progress, message, detail_json, video_path, subtitle_path, error, created_at, updated_at
               FROM subtitle_generation_jobs WHERE status = ? ORDER BY updated_at DESC LIMIT ?"#,
        )
        .bind(st)
        .bind(lim)
        .fetch_all(pool)
        .await
        .context("按状态列出生成任务")?
    } else {
        sqlx::query_as::<_, JobRow>(
            r#"SELECT id, status, phase, progress, message, detail_json, video_path, subtitle_path, error, created_at, updated_at
               FROM subtitle_generation_jobs ORDER BY updated_at DESC LIMIT ?"#,
        )
        .bind(lim)
        .fetch_all(pool)
        .await
        .context("列出生成任务")?
    };
    Ok(rows)
}

pub async fn find_running_job_for_video(
    pool: &SqlitePool,
    video_path: &str,
) -> anyhow::Result<Option<JobRow>> {
    let row = sqlx::query_as::<_, JobRow>(
        r#"SELECT id, status, phase, progress, message, detail_json, video_path, subtitle_path, error, created_at, updated_at
           FROM subtitle_generation_jobs
           WHERE video_path = ? AND status IN ('pending', 'running')
           ORDER BY updated_at DESC LIMIT 1"#,
    )
    .bind(video_path)
    .fetch_optional(pool)
    .await
    .context("查找视频对应的运行中任务")?;
    Ok(row)
}

/// Throttle writes to SQLite for progress updates.
pub struct ProgressThrottle {
    min_interval: Duration,
    last_flush: Option<Instant>,
}

impl ProgressThrottle {
    pub fn new(min_interval: Duration) -> Self {
        Self {
            min_interval,
            last_flush: None,
        }
    }

    pub async fn maybe_update(
        &mut self,
        pool: &SqlitePool,
        id: &str,
        phase: &str,
        progress: f64,
        message: &str,
        detail: Option<&JobDetail>,
        force: bool,
    ) -> anyhow::Result<()> {
        let now = Instant::now();
        let should = force
            || self.last_flush.is_none()
            || self
                .last_flush
                .map(|t| now.duration_since(t) >= self.min_interval)
                .unwrap_or(true);
        if !should {
            return Ok(());
        }
        self.last_flush = Some(now);
        update_job_progress(pool, id, phase, progress, message, detail)
            .await
            .context("节流写入任务进度")?;
        Ok(())
    }
}

pub fn parse_detail(json: &Option<String>) -> Option<JobDetail> {
    json.as_ref().and_then(|s| serde_json::from_str(s).ok())
}

pub fn row_to_response(row: JobRow) -> JobResponse {
    let detail = parse_detail(&row.detail_json);
    JobResponse {
        id: row.id,
        status: row.status,
        phase: row.phase,
        progress: row.progress,
        message: row.message,
        detail,
        video_path: row.video_path,
        subtitle_path: row.subtitle_path,
        error: row.error,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

#[derive(Serialize)]
pub struct JobResponse {
    pub id: String,
    pub status: String,
    pub phase: String,
    pub progress: f64,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<JobDetail>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub video_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

pub async fn fail_job(pool: &SqlitePool, id: &str, phase: &str, msg: &str) -> anyhow::Result<()> {
    set_job_failed(pool, id, phase, msg, msg)
        .await
        .context("fail_job")
}
