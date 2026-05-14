use std::time::Duration;

use anyhow::{Context, Result};
use chrono::Utc;
use ma_subtitle::{
    generate::generate_subtitle_by_video,
    types::SubtitleGenerateConfig,
};
use sqlx::SqlitePool;

use crate::subtitle_task::{
    append_task_record, get_subtitle_task, set_subtitle_task_status, types::SubtitleTaskStatus,
};
use crate::subtitle_translate_task::{
    create_subtitle_translate_task, types::SubtitleTranslateTaskCreateReq,
};
use crate::subtitle_translate_worker::SubtitleTranslateTaskQueue;
use crate::task_queue::BackgroundTaskQueue;
use ma_db::entity::subtitle_task::SubtitleTask;

pub type SubtitleTaskQueue = BackgroundTaskQueue;

pub fn spawn_subtitle_task_worker(
    db: SqlitePool,
    queue: SubtitleTaskQueue,
    translate_queue: SubtitleTranslateTaskQueue,
) {
    tokio::spawn(async move {
        loop {
            if let Err(e) = tick(&db, &queue, &translate_queue).await {
                tracing::error!(?e, "[subtitle-worker] tick failed");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    });
}

async fn tick(
    db: &SqlitePool,
    queue: &SubtitleTaskQueue,
    translate_queue: &SubtitleTranslateTaskQueue,
) -> Result<()> {
    // PAUSING / PAUSED 都不 claim 新任务
    if queue.is_pausing() || queue.is_paused() {
        tokio::select! {
            _ = queue.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
        // 无执行中长任务时，从 PAUSING 落到 PAUSED，避免前端卡在「暂停中」无法恢复
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
    let outcome = process_task(db, task_id, translate_queue).await;
    if let Err(e) = outcome {
        let _ = set_subtitle_task_status(db, task_id, &SubtitleTaskStatus::FAILED.to_string()).await;
        let _ = append_task_record(
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

async fn claim_next_pending_task(db: &SqlitePool) -> Result<Option<SubtitleTask>> {
    let task: Option<SubtitleTask> = sqlx::query_as::<_, SubtitleTask>(
        r#"
        SELECT task_id, task_status, video_path, config_json, created_at, updated_at
        FROM subtitle_task
        WHERE task_status = ?
        ORDER BY task_id ASC
        LIMIT 1
        "#,
    )
    .bind(SubtitleTaskStatus::PENDING.to_string())
    .fetch_optional(db)
    .await?;

    let Some(task) = task else {
        return Ok(None);
    };

    let now = Utc::now().to_rfc3339();
    let res = sqlx::query(
        r#"
        UPDATE subtitle_task
        SET task_status = ?, updated_at = ?
        WHERE task_id = ? AND task_status = ?
        "#,
    )
    .bind(SubtitleTaskStatus::RUNNING.to_string())
    .bind(&now)
    .bind(task.task_id)
    .bind(SubtitleTaskStatus::PENDING.to_string())
    .execute(db)
    .await?;

    if res.rows_affected() == 0 {
        return Ok(None);
    }

    let claimed = get_subtitle_task(db, task.task_id).await?;
    Ok(Some(claimed))
}

async fn process_task(
    db: &SqlitePool,
    task_id: i32,
    translate_queue: &SubtitleTranslateTaskQueue,
) -> Result<()> {
    append_task_record(db, task_id, "INFO", "任务开始", "").await?;

    let task = get_subtitle_task(db, task_id).await?;
    let cfg: SubtitleGenerateConfig = serde_json::from_str(&task.config_json)
        .context("解析 config_json 失败")?;

    let gen_res = generate_subtitle_by_video(&cfg).await;

    match gen_res {
        Ok(outcome) => {
            let now = Utc::now().to_rfc3339();
            for it in &outcome.items {
                sqlx::query(
                    r#"
                    INSERT INTO generated_subtitles (task_id, subtitle_path, created_at)
                    VALUES (?, ?, ?)
                    "#,
                )
                .bind(task_id)
                .bind(&it.srt_path)
                .bind(&now)
                .execute(db)
                .await?;
            }

            if let Some(pending) = outcome.pending_translate {
                match create_subtitle_translate_task(
                    db,
                    SubtitleTranslateTaskCreateReq {
                        source_srt_path: pending.source_srt_path,
                        config: pending.config,
                    },
                )
                .await
                {
                    Ok(t) => {
                        translate_queue.enqueue();
                        append_task_record(
                            db,
                            task_id,
                            "INFO",
                            "已加入字幕翻译队列",
                            &format!("翻译任务 task_id={}", t.task_id),
                        )
                        .await?;
                    }
                    Err(e) => {
                        append_task_record(
                            db,
                            task_id,
                            "ERROR",
                            "加入字幕翻译队列失败",
                            &format!("{e:#}"),
                        )
                        .await?;
                    }
                }
            }

            set_subtitle_task_status(db, task_id, &SubtitleTaskStatus::COMPLETED.to_string())
                .await?;
            append_task_record(db, task_id, "INFO", "任务完成", "").await?;
        }
        Err(e) => {
            set_subtitle_task_status(db, task_id, &SubtitleTaskStatus::FAILED.to_string()).await?;
            append_task_record(db, task_id, "ERROR", "任务失败", &format!("{e:#}")).await?;
        }
    }

    Ok(())
}
