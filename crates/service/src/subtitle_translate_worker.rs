use std::{path::Path, time::Duration};

use anyhow::{Context, Result};
use chrono::Utc;
use ma_subtitle::{translate::translate_srt_file, types::SubtitleTranslateConfig};
use sqlx::SqlitePool;

use crate::subtitle_translate_task::{
    append_translate_task_record, get_subtitle_translate_task,
    set_subtitle_translate_task_status, types::SubtitleTranslateTaskStatus,
};
use crate::task_queue::BackgroundTaskQueue;
use ma_db::entity::subtitle_translate_task::SubtitleTranslateTask;

pub type SubtitleTranslateTaskQueue = BackgroundTaskQueue;

pub fn spawn_subtitle_translate_task_worker(
    db: SqlitePool,
    queue: SubtitleTranslateTaskQueue,
) {
    tokio::spawn(async move {
        loop {
            if let Err(e) = tick(&db, &queue).await {
                tracing::error!(?e, "[subtitle-translate-worker] tick failed");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    });
}

async fn tick(db: &SqlitePool, queue: &SubtitleTranslateTaskQueue) -> Result<()> {
    if queue.is_pausing() || queue.is_paused() {
        tokio::select! {
            _ = queue.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
        queue.mark_paused_if_pausing();
        return Ok(());
    }

    let task = claim_next_pending_task(db).await?;
    let Some(task) = task else {
        tokio::select! {
            _ = queue.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
        queue.mark_paused_if_pausing();
        return Ok(());
    };

    let task_id = task.task_id;
    let outcome = process_translate_task(db, task_id).await;
    if let Err(e) = outcome {
        let _ = set_subtitle_translate_task_status(
            db,
            task_id,
            &SubtitleTranslateTaskStatus::FAILED.to_string(),
        )
        .await;
        let _ = append_translate_task_record(
            db,
            task_id,
            "ERROR",
            "任务异常退出",
            &format!("{e:#}"),
        )
        .await;
    }
    queue.mark_paused_if_pausing();
    Ok(())
}

async fn claim_next_pending_task(
    db: &SqlitePool,
) -> Result<Option<SubtitleTranslateTask>> {
    let task: Option<SubtitleTranslateTask> = sqlx::query_as::<_, SubtitleTranslateTask>(
        r#"
        SELECT task_id, task_status, source_srt_path, config_json, created_at, updated_at
        FROM subtitle_translate_task
        WHERE task_status = ?
        ORDER BY task_id ASC
        LIMIT 1
        "#,
    )
    .bind(SubtitleTranslateTaskStatus::PENDING.to_string())
    .fetch_optional(db)
    .await?;

    let Some(task) = task else {
        return Ok(None);
    };

    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(
        r#"
        UPDATE subtitle_translate_task
        SET task_status = ?, updated_at = ?
        WHERE task_id = ? AND task_status = ?
        "#,
    )
    .bind(SubtitleTranslateTaskStatus::RUNNING.to_string())
    .bind(&now)
    .bind(task.task_id)
    .bind(SubtitleTranslateTaskStatus::PENDING.to_string())
    .execute(db)
    .await?;

    if res.rows_affected() == 0 {
        return Ok(None);
    }

    let claimed = get_subtitle_translate_task(db, task.task_id).await?;
    Ok(Some(claimed))
}

async fn process_translate_task(db: &SqlitePool, task_id: i32) -> Result<()> {
    append_translate_task_record(db, task_id, "INFO", "任务开始", "").await?;

    let task = get_subtitle_translate_task(db, task_id).await?;
    let cfg: SubtitleTranslateConfig = serde_json::from_str(&task.config_json)
        .context("解析 config_json 失败")?;

    let src = Path::new(&task.source_srt_path);
    let out = translate_srt_file(src, None, &cfg).await;

    match out {
        Ok(path) => {
            set_subtitle_translate_task_status(
                db,
                task_id,
                &SubtitleTranslateTaskStatus::COMPLETED.to_string(),
            )
            .await?;
            append_translate_task_record(
                db,
                task_id,
                "INFO",
                "任务完成",
                &path.display().to_string(),
            )
            .await?;
        }
        Err(e) => {
            set_subtitle_translate_task_status(
                db,
                task_id,
                &SubtitleTranslateTaskStatus::FAILED.to_string(),
            )
            .await?;
            append_translate_task_record(
                db,
                task_id,
                "ERROR",
                "任务失败",
                &format!("{e:#}"),
            )
            .await?;
        }
    }

    Ok(())
}
