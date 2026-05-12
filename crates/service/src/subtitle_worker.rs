use std::time::Duration;

use anyhow::{Context, Result};
use chrono::Utc;
use ma_subtitle::{
    generate::generate_subtitle_by_video,
    types::SubtitleGenerateConfig,
};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, Set,
};

use crate::subtitle_task::{
    append_task_record, get_subtitle_task, set_subtitle_task_status, types::SubtitleTaskStatus,
};
use crate::subtitle_translate_task::{
    create_subtitle_translate_task, types::SubtitleTranslateTaskCreateReq,
};
use crate::subtitle_translate_worker::SubtitleTranslateTaskQueue;
use crate::task_queue::BackgroundTaskQueue;
use ma_db::entity::generated_subtitles::ActiveModel as GeneratedSubtitlesActiveModel;
use ma_db::entity::subtitle_task::Column as SubtitleTaskColumn;
use ma_db::entity::subtitle_task::Entity as SubtitleTaskEntity;
use ma_db::entity::subtitle_task::Model as SubtitleTaskModel;

pub type SubtitleTaskQueue = BackgroundTaskQueue;

pub fn spawn_subtitle_task_worker(
    db: DatabaseConnection,
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
    db: &DatabaseConnection,
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

async fn claim_next_pending_task(db: &DatabaseConnection) -> Result<Option<SubtitleTaskModel>> {
    let task = SubtitleTaskEntity::find()
        .filter(SubtitleTaskColumn::TaskStatus.eq(SubtitleTaskStatus::PENDING.to_string()))
        .order_by_asc(SubtitleTaskColumn::TaskId)
        .one(db)
        .await?;

    let Some(task) = task else {
        return Ok(None);
    };

    let now = Utc::now().to_rfc3339();
    let res = SubtitleTaskEntity::update_many()
        .col_expr(
            SubtitleTaskColumn::TaskStatus,
            sea_orm::sea_query::Expr::value(SubtitleTaskStatus::RUNNING.to_string()),
        )
        .col_expr(
            SubtitleTaskColumn::UpdatedAt,
            sea_orm::sea_query::Expr::value(now),
        )
        .filter(SubtitleTaskColumn::TaskId.eq(task.task_id))
        .filter(SubtitleTaskColumn::TaskStatus.eq(SubtitleTaskStatus::PENDING.to_string()))
        .exec(db)
        .await?;

    if res.rows_affected == 0 {
        return Ok(None);
    }

    let claimed = get_subtitle_task(db, task.task_id).await?;
    Ok(Some(claimed))
}

async fn process_task(
    db: &DatabaseConnection,
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
                let model = GeneratedSubtitlesActiveModel {
                    subtitle_id: ActiveValue::NotSet,
                    task_id: Set(Some(task_id)),
                    subtitle_path: Set(it.srt_path.clone()),
                    created_at: Set(now.clone()),
                };
                model.insert(db).await?;
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
