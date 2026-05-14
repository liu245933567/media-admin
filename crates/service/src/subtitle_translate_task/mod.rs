use anyhow::{Result, bail};
use chrono::Utc;

use sqlx::{QueryBuilder, Sqlite, SqlitePool};

use ma_db::entity::subtitle_translate_task::SubtitleTranslateTask;

pub mod types;
pub use types::*;

pub async fn create_subtitle_translate_task(
    db: &SqlitePool,
    req: SubtitleTranslateTaskCreateReq,
) -> Result<SubtitleTranslateTaskItem> {
    let source_srt_path = req.source_srt_path.trim().to_string();
    if source_srt_path.is_empty() {
        bail!("source_srt_path 不能为空");
    }
    let config_json = serde_json::to_string(&req.config)
        .map_err(|e| anyhow::anyhow!("序列化 config 失败: {}", e))?;

    let now = Utc::now().to_rfc3339();

    let inserted = sqlx::query_as::<_, SubtitleTranslateTask>(
        r#"
        INSERT INTO subtitle_translate_task (task_status, source_srt_path, config_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        RETURNING task_id, task_status, source_srt_path, config_json, created_at, updated_at
        "#,
    )
    .bind(SubtitleTranslateTaskStatus::PENDING.to_string())
    .bind(&source_srt_path)
    .bind(&config_json)
    .bind(&now)
    .bind(&now)
    .fetch_one(db)
    .await?;

    Ok(row_from_model(inserted))
}

fn row_from_model(m: SubtitleTranslateTask) -> SubtitleTranslateTaskItem {
    SubtitleTranslateTaskItem {
        task_id: m.task_id,
        task_status: m.task_status,
        source_srt_path: m.source_srt_path,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

fn push_translate_task_list_filters(
    qb: &mut QueryBuilder<'_, Sqlite>,
    req: &SubtitleTranslateTaskListReq,
) {
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
        .path_contains
        .as_ref()
        .map(|x| x.trim())
        .filter(|x| !x.is_empty())
    {
        qb.push(" AND source_srt_path LIKE ");
        qb.push_bind(format!("%{p}%"));
    }
}

pub async fn list_subtitle_translate_tasks(
    db: &SqlitePool,
    req: &SubtitleTranslateTaskListReq,
) -> Result<SubtitleTranslateTaskListRes> {
    let page = u64::from(req.current.max(1));
    let page_size = u64::from(req.page_size.clamp(1, 100));
    let limit_i = i64::try_from(page_size)?;
    let offset_i = i64::try_from((page - 1).saturating_mul(page_size))?;

    let total: i64 = {
        let mut qb =
            QueryBuilder::new("SELECT COUNT(*) FROM subtitle_translate_task WHERE 1=1");
        push_translate_task_list_filters(&mut qb, req);
        qb.build_query_scalar().fetch_one(db).await?
    };

    let mut qb = QueryBuilder::new(
        "SELECT task_id, task_status, source_srt_path, config_json, created_at, updated_at FROM subtitle_translate_task WHERE 1=1",
    );
    push_translate_task_list_filters(&mut qb, req);
    qb.push(" ORDER BY task_id DESC LIMIT ");
    qb.push_bind(limit_i);
    qb.push(" OFFSET ");
    qb.push_bind(offset_i);

    let models: Vec<SubtitleTranslateTask> =
        qb.build_query_as::<SubtitleTranslateTask>().fetch_all(db).await?;

    let items = models
        .into_iter()
        .map(|m| SubtitleTranslateTaskRow {
            task_id: m.task_id,
            task_status: m.task_status,
            source_srt_path: m.source_srt_path,
            created_at: m.created_at,
            updated_at: m.updated_at,
        })
        .collect();

    Ok(SubtitleTranslateTaskListRes {
        items,
        total: i32::try_from(total)?,
    })
}

pub async fn delete_subtitle_translate_task(
    db: &SqlitePool,
    task_id: i32,
) -> Result<SubtitleTranslateTaskDeleteRes> {
    let task: Option<SubtitleTranslateTask> = sqlx::query_as::<_, SubtitleTranslateTask>(
        r#"
        SELECT task_id, task_status, source_srt_path, config_json, created_at, updated_at
        FROM subtitle_translate_task WHERE task_id = ?
        "#,
    )
    .bind(task_id)
    .fetch_optional(db)
    .await?;
    let Some(task) = task else {
        bail!("任务不存在");
    };
    if task.task_status == SubtitleTranslateTaskStatus::RUNNING.to_string() {
        bail!("处理中的任务不可删除");
    }

    let mut tx = db.begin().await?;

    sqlx::query("DELETE FROM subtitle_translate_task_record WHERE task_id = ?")
        .bind(task_id)
        .execute(&mut *tx)
        .await?;

    let del = sqlx::query("DELETE FROM subtitle_translate_task WHERE task_id = ?")
        .bind(task_id)
        .execute(&mut *tx)
        .await?;
    if del.rows_affected() == 0 {
        tx.rollback().await?;
        bail!("任务不存在");
    }

    tx.commit().await?;
    Ok(SubtitleTranslateTaskDeleteRes { ok: true })
}

pub async fn retry_subtitle_translate_task(
    db: &SqlitePool,
    task_id: i32,
) -> Result<SubtitleTranslateTaskRetryRes> {
    let task: Option<SubtitleTranslateTask> = sqlx::query_as::<_, SubtitleTranslateTask>(
        r#"
        SELECT task_id, task_status, source_srt_path, config_json, created_at, updated_at
        FROM subtitle_translate_task WHERE task_id = ?
        "#,
    )
    .bind(task_id)
    .fetch_optional(db)
    .await?;
    let Some(task) = task else {
        bail!("任务不存在");
    };
    if task.task_status != SubtitleTranslateTaskStatus::FAILED.to_string() {
        bail!("仅失败任务可重新开始");
    }

    let mut tx = db.begin().await?;

    sqlx::query("DELETE FROM subtitle_translate_task_record WHERE task_id = ?")
        .bind(task_id)
        .execute(&mut *tx)
        .await?;

    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(
        "UPDATE subtitle_translate_task SET task_status = ?, updated_at = ? WHERE task_id = ?",
    )
    .bind(SubtitleTranslateTaskStatus::PENDING.to_string())
    .bind(&now)
    .bind(task_id)
    .execute(&mut *tx)
    .await?;

    if res.rows_affected() == 0 {
        tx.rollback().await?;
        bail!("任务不存在");
    }

    tx.commit().await?;
    Ok(SubtitleTranslateTaskRetryRes { ok: true })
}

pub async fn get_subtitle_translate_task(
    db: &SqlitePool,
    task_id: i32,
) -> Result<SubtitleTranslateTask> {
    let task = sqlx::query_as::<_, SubtitleTranslateTask>(
        r#"
        SELECT task_id, task_status, source_srt_path, config_json, created_at, updated_at
        FROM subtitle_translate_task WHERE task_id = ?
        "#,
    )
    .bind(task_id)
    .fetch_optional(db)
    .await?;
    task.ok_or_else(|| anyhow::anyhow!("任务不存在"))
}

pub async fn set_subtitle_translate_task_status(
    db: &SqlitePool,
    task_id: i32,
    status: &str,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(
        "UPDATE subtitle_translate_task SET task_status = ?, updated_at = ? WHERE task_id = ?",
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

pub async fn append_translate_task_record(
    db: &SqlitePool,
    task_id: i32,
    record_status: &str,
    record_desc: &str,
    record_detail: &str,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    sqlx::query(
        r#"
        INSERT INTO subtitle_translate_task_record
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

pub async fn pause_subtitle_translate_task_queue(
    _db: &SqlitePool,
) -> Result<SubtitleTranslateTaskQueuePauseRes> {
    Ok(SubtitleTranslateTaskQueuePauseRes { ok: true })
}

pub async fn resume_subtitle_translate_task_queue(
    _db: &SqlitePool,
) -> Result<SubtitleTranslateTaskQueueResumeRes> {
    Ok(SubtitleTranslateTaskQueueResumeRes { ok: true })
}
