use std::{
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    },
    time::Duration,
};

use anyhow::{Context, Result};
use chrono::Utc;
use ma_subtitle::{generate::generate_subtitle_by_video, types::SubtitleGenerateConfig};
use sea_orm::{
    ActiveModelTrait, ActiveValue, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter,
    QueryOrder, Set,
};
use tokio::sync::Notify;

use crate::subtitle_task::{
    append_task_record, get_subtitle_task, set_subtitle_task_status, types::SubtitleTaskStatus,
};
use ma_db::entity::generated_subtitles::ActiveModel as GeneratedSubtitlesActiveModel;
use ma_db::entity::subtitle_task::Column as SubtitleTaskColumn;
use ma_db::entity::subtitle_task::Entity as SubtitleTaskEntity;
use ma_db::entity::subtitle_task::Model as SubtitleTaskModel;

const QUEUE_STATE_RUNNING: u8 = 0;
const QUEUE_STATE_PAUSING: u8 = 1;
const QUEUE_STATE_PAUSED: u8 = 2;

#[derive(Clone)]
pub struct SubtitleTaskQueue {
    notify: Arc<Notify>,
    state: Arc<AtomicU8>,
}

impl SubtitleTaskQueue {
    pub fn new() -> Self {
        Self {
            notify: Arc::new(Notify::new()),
            state: Arc::new(AtomicU8::new(QUEUE_STATE_RUNNING)),
        }
    }

    pub fn enqueue(&self) {
        self.notify.notify_one();
    }

    /// 请求暂停：允许当前 RUNNING 任务跑完后进入 PAUSED
    pub fn request_pause(&self) {
        self.state.store(QUEUE_STATE_PAUSING, Ordering::Relaxed);
    }

    pub fn resume(&self) {
        self.state.store(QUEUE_STATE_RUNNING, Ordering::Relaxed);
        self.notify.notify_one();
    }

    pub fn is_pausing(&self) -> bool {
        self.state.load(Ordering::Relaxed) == QUEUE_STATE_PAUSING
    }

    pub fn is_paused(&self) -> bool {
        self.state.load(Ordering::Relaxed) == QUEUE_STATE_PAUSED
    }

    pub fn status(&self) -> &'static str {
        match self.state.load(Ordering::Relaxed) {
            QUEUE_STATE_RUNNING => "RUNNING",
            QUEUE_STATE_PAUSING => "PAUSING",
            QUEUE_STATE_PAUSED => "PAUSED",
            _ => "UNKNOWN",
        }
    }

    fn mark_paused_if_pausing(&self) {
        if self.is_pausing() {
            self.state.store(QUEUE_STATE_PAUSED, Ordering::Relaxed);
        }
    }
}

pub fn spawn_subtitle_task_worker(db: DatabaseConnection, queue: SubtitleTaskQueue) {
    tokio::spawn(async move {
        loop {
            if let Err(e) = tick(&db, &queue).await {
                tracing::error!(?e, "[subtitle-worker] tick failed");
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
        }
    });
}

async fn tick(db: &DatabaseConnection, queue: &SubtitleTaskQueue) -> Result<()> {
    // PAUSING / PAUSED 都不 claim 新任务
    if queue.is_pausing() || queue.is_paused() {
        tokio::select! {
            _ = queue.notify.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
        return Ok(());
    }

    let task = claim_next_pending_task(db).await?;
    let Some(task) = task else {
        tokio::select! {
            _ = queue.notify.notified() => {}
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
        return Ok(());
    };

    process_task(db, queue, task.task_id).await?;
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
    queue: &SubtitleTaskQueue,
    task_id: i32,
) -> Result<()> {
    append_task_record(db, task_id, "INFO", "任务开始", "").await?;

    let task = get_subtitle_task(db, task_id).await?;
    let cfg: SubtitleGenerateConfig =
        serde_json::from_str(&task.config_json).context("解析 config_json 失败")?;

    let gen_res = generate_subtitle_by_video(&SubtitleGenerateConfig {
        video_path: cfg.video_path,
        ..Default::default()
    })
    .await;

    match gen_res {
        Ok(items) => {
            let now = Utc::now().to_rfc3339();
            for it in items {
                let model = GeneratedSubtitlesActiveModel {
                    subtitle_id: ActiveValue::NotSet,
                    task_id: Set(Some(task_id)),
                    subtitle_path: Set(it.srt_path),
                    created_at: Set(now.clone()),
                };
                model.insert(db).await?;
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

    // 若队列处于“暂停中”，当前任务执行完成后进入“已暂停”并停止 claim 新任务
    queue.mark_paused_if_pausing();

    Ok(())
}
