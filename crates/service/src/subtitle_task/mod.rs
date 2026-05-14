use anyhow::{Result, bail};
use chrono::Utc;

use sqlx::{QueryBuilder, Sqlite, SqlitePool};

use ma_db::entity::subtitle_task::SubtitleTask;

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

pub mod types;
use ma_subtitle::types::SubtitleGenerateConfig;
use types::*;

/// 新建任务表单的默认配置（与 `SubtitleGenerateConfig::default()` 一致）
pub fn default_subtitle_generate_config() -> SubtitleTaskGenerateDefaultsRes {
    SubtitleTaskGenerateDefaultsRes {
        config: SubtitleGenerateConfig::default(),
    }
}

pub async fn create_subtitle_task(
    db: &SqlitePool,
    req: SubtitleTaskCreateReq,
) -> Result<SubtitleTaskItem> {
    let video_path = req.config.video_path.trim().to_string();
    if video_path.is_empty() {
        bail!("video_path 不能为空");
    }
    let config_json = serde_json::to_string(&req.config)
        .map_err(|e| anyhow::anyhow!("序列化 config 失败: {}", e))?;

    let now = Utc::now().to_rfc3339();

    let inserted = sqlx::query_as::<_, SubtitleTask>(
        r#"
        INSERT INTO subtitle_task (task_status, video_path, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        RETURNING task_id, task_status, video_path, config_json, created_at, updated_at
        "#,
    )
    .bind(SubtitleTaskStatus::PENDING.to_string())
    .bind(&video_path)
    .bind(&config_json)
    .bind(&now)
    .bind(&now)
    .fetch_one(db)
    .await?;

    Ok(row_from_model(inserted))
}

pub async fn bulk_create_subtitle_tasks(
    db: &SqlitePool,
    req: SubtitleTaskBulkCreateReq,
) -> Result<SubtitleTaskBulkCreateRes> {
    let SubtitleTaskBulkCreateReq {
        configs,
        skip_if_exists,
    } = req;
    if configs.is_empty() {
        bail!("configs 不能为空");
    }

    let skip_if_exists = skip_if_exists.unwrap_or(true);

    let mut created: Vec<SubtitleTaskItem> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();
    let mut failed: Vec<SubtitleTaskBulkCreateFailedItem> = Vec::new();

    for cfg in configs.into_iter() {
        let video_path = cfg.video_path.trim().to_string();
        if video_path.is_empty() {
            failed.push(SubtitleTaskBulkCreateFailedItem {
                video_path,
                error: "video_path 不能为空".to_string(),
            });
            continue;
        }

        if skip_if_exists {
            let existing: Option<SubtitleTask> = sqlx::query_as::<_, SubtitleTask>(
                r#"
                SELECT task_id, task_status, video_path, config_json, created_at, updated_at
                FROM subtitle_task
                WHERE video_path = ? AND task_status IN ('PENDING', 'RUNNING')
                LIMIT 1
                "#,
            )
            .bind(&video_path)
            .fetch_optional(db)
            .await?;
            if existing.is_some() {
                skipped.push(video_path);
                continue;
            }
        }

        match create_subtitle_task(db, SubtitleTaskCreateReq { config: cfg }).await {
            Ok(row) => created.push(row),
            Err(e) => failed.push(SubtitleTaskBulkCreateFailedItem {
                video_path,
                error: e.to_string(),
            }),
        }
    }

    Ok(SubtitleTaskBulkCreateRes {
        created,
        skipped,
        failed,
    })
}

fn row_from_model(m: SubtitleTask) -> SubtitleTaskItem {
    SubtitleTaskItem {
        task_id: m.task_id,
        task_status: m.task_status,
        video_path: m.video_path,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

fn push_subtitle_task_list_filters(qb: &mut QueryBuilder<'_, Sqlite>, req: &SubtitleTaskListReq) {
    if let Some(s) = req
        .task_status
        .as_ref()
        .map(|x| x.trim())
        .filter(|x| !x.is_empty())
    {
        qb.push(" AND task_status = ");
        qb.push_bind(s.to_string());
    }
    if let Some(p) = req
        .video_path_contains
        .as_ref()
        .map(|x| x.trim())
        .filter(|x| !x.is_empty())
    {
        qb.push(" AND video_path LIKE ");
        qb.push_bind(format!("%{p}%"));
    }
}

pub async fn list_subtitle_tasks(
    db: &SqlitePool,
    req: &SubtitleTaskListReq,
) -> Result<SubtitleTaskListRes> {
    let page = u64::from(req.current.max(1));
    let page_size = u64::from(req.page_size.clamp(1, 100));
    let limit_i = i64::try_from(page_size)?;
    let offset_i = i64::try_from((page - 1).saturating_mul(page_size))?;

    let total: i64 = {
        let mut qb = QueryBuilder::new("SELECT COUNT(*) FROM subtitle_task WHERE 1=1");
        push_subtitle_task_list_filters(&mut qb, req);
        qb.build_query_scalar().fetch_one(db).await?
    };

    let mut qb = QueryBuilder::new(
        "SELECT task_id, task_status, video_path, config_json, created_at, updated_at FROM subtitle_task WHERE 1=1",
    );
    push_subtitle_task_list_filters(&mut qb, req);
    qb.push(" ORDER BY task_id DESC LIMIT ");
    qb.push_bind(limit_i);
    qb.push(" OFFSET ");
    qb.push_bind(offset_i);

    let models: Vec<SubtitleTask> = qb.build_query_as::<SubtitleTask>().fetch_all(db).await?;

    let items = models
        .into_iter()
        .map(|m| SubtitleTaskRow {
            task_id: m.task_id,
            task_status: m.task_status,
            video_path: m.video_path,
            created_at: m.created_at,
            updated_at: m.updated_at,
        })
        .collect();

    Ok(SubtitleTaskListRes {
        items,
        total: i32::try_from(total)?,
    })
}

pub async fn retry_subtitle_task(db: &SqlitePool, task_id: i32) -> Result<SubtitleTaskRetryRes> {
    let task: Option<SubtitleTask> = sqlx::query_as::<_, SubtitleTask>(
        r#"
        SELECT task_id, task_status, video_path, config_json, created_at, updated_at
        FROM subtitle_task WHERE task_id = ?
        "#,
    )
    .bind(task_id)
    .fetch_optional(db)
    .await?;
    let Some(task) = task else {
        bail!("任务不存在");
    };
    if task.task_status != SubtitleTaskStatus::FAILED.to_string() {
        bail!("仅失败任务可重新开始");
    }

    let mut tx = db.begin().await?;

    sqlx::query("DELETE FROM subtitle_task_record WHERE task_id = ?")
        .bind(task_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM generated_subtitles WHERE task_id = ?")
        .bind(task_id)
        .execute(&mut *tx)
        .await?;

    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(
        "UPDATE subtitle_task SET task_status = ?, updated_at = ? WHERE task_id = ?",
    )
    .bind(SubtitleTaskStatus::PENDING.to_string())
    .bind(&now)
    .bind(task_id)
    .execute(&mut *tx)
    .await?;

    if res.rows_affected() == 0 {
        tx.rollback().await?;
        bail!("任务不存在");
    }

    tx.commit().await?;
    Ok(SubtitleTaskRetryRes { ok: true })
}

pub async fn delete_subtitle_task(
    db: &SqlitePool,
    task_id: i32,
) -> Result<SubtitleTaskDeleteRes> {
    let task: Option<SubtitleTask> = sqlx::query_as::<_, SubtitleTask>(
        r#"
        SELECT task_id, task_status, video_path, config_json, created_at, updated_at
        FROM subtitle_task WHERE task_id = ?
        "#,
    )
    .bind(task_id)
    .fetch_optional(db)
    .await?;
    let Some(task) = task else {
        bail!("任务不存在");
    };
    if task.task_status == SubtitleTaskStatus::RUNNING.to_string() {
        bail!("处理中的任务不可删除");
    }

    let mut tx = db.begin().await?;

    sqlx::query("DELETE FROM subtitle_task_record WHERE task_id = ?")
        .bind(task_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM generated_subtitles WHERE task_id = ?")
        .bind(task_id)
        .execute(&mut *tx)
        .await?;

    let del = sqlx::query("DELETE FROM subtitle_task WHERE task_id = ?")
        .bind(task_id)
        .execute(&mut *tx)
        .await?;
    if del.rows_affected() == 0 {
        tx.rollback().await?;
        bail!("任务不存在");
    }

    tx.commit().await?;
    Ok(SubtitleTaskDeleteRes { ok: true })
}

pub async fn get_subtitle_task(db: &SqlitePool, task_id: i32) -> Result<SubtitleTask> {
    let task = sqlx::query_as::<_, SubtitleTask>(
        r#"
        SELECT task_id, task_status, video_path, config_json, created_at, updated_at
        FROM subtitle_task WHERE task_id = ?
        "#,
    )
    .bind(task_id)
    .fetch_optional(db)
    .await?;
    task.ok_or_else(|| anyhow::anyhow!("任务不存在"))
}

pub async fn set_subtitle_task_status(
    db: &SqlitePool,
    task_id: i32,
    status: &str,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(
        "UPDATE subtitle_task SET task_status = ?, updated_at = ? WHERE task_id = ?",
    )
    .bind(status)
    .bind(&now)
    .bind(task_id)
    .execute(db)
    .await?;
    if res.rows_affected() == 0 {
        bail!("任务不存在");
    }
    Ok(())
}

pub async fn append_task_record(
    db: &SqlitePool,
    task_id: i32,
    record_status: &str,
    record_desc: &str,
    record_detail: &str,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"
        INSERT INTO subtitle_task_record
            (task_id, record_status, record_desc, record_detail, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(task_id)
    .bind(record_status)
    .bind(record_desc)
    .bind(record_detail)
    .bind(&now)
    .bind(&now)
    .execute(db)
    .await?;
    Ok(())
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleTaskQueuePauseReq {}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTaskQueuePauseRes {
    pub ok: bool,
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleTaskQueueStatusReq {}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTaskQueueStatusRes {
    /// RUNNING / PAUSING / PAUSED
    pub status: String,
}

pub async fn pause_subtitle_task_queue(_db: &SqlitePool) -> Result<SubtitleTaskQueuePauseRes> {
    // 仅用于队列暂停“意图”，不再中断当前 RUNNING 任务
    Ok(SubtitleTaskQueuePauseRes { ok: true })
}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTaskQueueResumeRes {
    pub ok: bool,
}

pub async fn resume_subtitle_task_queue(_db: &SqlitePool) -> Result<SubtitleTaskQueueResumeRes> {
    Ok(SubtitleTaskQueueResumeRes { ok: true })
}
