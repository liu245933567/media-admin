use anyhow::{Result, bail};
use chrono::Utc;

use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, NotSet, PaginatorTrait,
    QueryFilter, QueryOrder, Set, TransactionTrait,
};

use ma_db::entity::subtitle_task::Column as SubtitleTaskColumn;
use ma_db::entity::subtitle_task::Entity as SubtitleTaskEntity;
use ma_db::entity::subtitle_task::Model as SubtitleTaskModel;

use ma_db::entity::subtitle_task_record::Column as SubtitleTaskRecordColumn;
use ma_db::entity::subtitle_task_record::Entity as SubtitleTaskRecordEntity;
use ma_db::entity::subtitle_task_record::ActiveModel as SubtitleTaskRecordActiveModel;

use ma_db::entity::generated_subtitles::Column as GeneratedSubtitlesColumn;
use ma_db::entity::generated_subtitles::Entity as GeneratedSubtitlesEntity;

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

pub mod types;
use types::*;

pub async fn create_subtitle_task(
    db: &DatabaseConnection,
    req: SubtitleTaskCreateReq,
) -> Result<SubtitleTaskItem> {
    let video_path = req.config.video_path.trim().to_string();
    if video_path.is_empty() {
        bail!("video_path 不能为空");
    }
    let config_json = serde_json::to_string(&req.config)
        .map_err(|e| anyhow::anyhow!("序列化 config 失败: {}", e))?;

    let now = Utc::now().to_rfc3339();

    let model = ma_db::entity::subtitle_task::ActiveModel {
        task_id: NotSet,
        task_status: Set(SubtitleTaskStatus::PENDING.to_string()),
        video_path: Set(video_path.clone()),
        config_json: Set(config_json),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
    };

    let inserted = model.insert(db).await?;

    Ok(row_from_model(inserted))
}

pub async fn bulk_create_subtitle_tasks(
    db: &DatabaseConnection,
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
            let existing = SubtitleTaskEntity::find()
                .filter(SubtitleTaskColumn::VideoPath.eq(video_path.clone()))
                .filter(SubtitleTaskColumn::TaskStatus.is_in([
                    SubtitleTaskStatus::PENDING.to_string(),
                    SubtitleTaskStatus::RUNNING.to_string(),
                ]))
                .one(db)
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

fn row_from_model(m: SubtitleTaskModel) -> SubtitleTaskItem {
    SubtitleTaskItem {
        task_id: m.task_id,
        task_status: m.task_status,
        video_path: m.video_path,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

pub async fn list_subtitle_tasks(
    db: &DatabaseConnection,
    req: &SubtitleTaskListReq,
) -> Result<SubtitleTaskListRes> {
    let page = req.current.max(1);
    let page_size = req.page_size.clamp(1, 100);

    let mut q = SubtitleTaskEntity::find();
    if let Some(s) = req
        .task_status
        .as_ref()
        .map(|x| x.trim())
        .filter(|x| !x.is_empty())
    {
        q = q.filter(SubtitleTaskColumn::TaskStatus.eq(s.to_string()));
    }
    if let Some(p) = req
        .video_path_contains
        .as_ref()
        .map(|x| x.trim())
        .filter(|x| !x.is_empty())
    {
        q = q.filter(SubtitleTaskColumn::VideoPath.contains(p));
    }

    let paginator = q
        .order_by_desc(SubtitleTaskColumn::TaskId)
        .paginate(db, page_size);

    let total = paginator.num_items().await? as i32;
    let models = paginator.fetch_page(page - 1).await?;

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

    Ok(SubtitleTaskListRes { items, total })
}

pub async fn delete_subtitle_task(
    db: &DatabaseConnection,
    task_id: i32,
) -> Result<SubtitleTaskDeleteRes> {
    let task = SubtitleTaskEntity::find_by_id(task_id).one(db).await?;
    let Some(task) = task else {
        bail!("任务不存在");
    };
    if task.task_status == SubtitleTaskStatus::RUNNING.to_string() {
        bail!("处理中的任务不可删除");
    }

    let txn = db.begin().await?;

    SubtitleTaskRecordEntity::delete_many()
        .filter(SubtitleTaskRecordColumn::TaskId.eq(task_id))
        .exec(&txn)
        .await?;

    GeneratedSubtitlesEntity::delete_many()
        .filter(GeneratedSubtitlesColumn::TaskId.eq(task_id))
        .exec(&txn)
        .await?;

    let del = SubtitleTaskEntity::delete_by_id(task_id).exec(&txn).await?;
    if del.rows_affected == 0 {
        txn.rollback().await?;
        bail!("任务不存在");
    }

    txn.commit().await?;
    Ok(SubtitleTaskDeleteRes { ok: true })
}

pub async fn get_subtitle_task(db: &DatabaseConnection, task_id: i32) -> Result<SubtitleTaskModel> {
    let task = SubtitleTaskEntity::find_by_id(task_id).one(db).await?;
    task.ok_or_else(|| anyhow::anyhow!("任务不存在"))
}

pub async fn set_subtitle_task_status(
    db: &DatabaseConnection,
    task_id: i32,
    status: &str,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let res = SubtitleTaskEntity::update_many()
        .col_expr(
            SubtitleTaskColumn::TaskStatus,
            sea_orm::sea_query::Expr::value(status.to_string()),
        )
        .col_expr(
            SubtitleTaskColumn::UpdatedAt,
            sea_orm::sea_query::Expr::value(now),
        )
        .filter(SubtitleTaskColumn::TaskId.eq(task_id))
        .exec(db)
        .await?;
    if res.rows_affected == 0 {
        bail!("任务不存在");
    }
    Ok(())
}

pub async fn append_task_record(
    db: &DatabaseConnection,
    task_id: i32,
    record_status: &str,
    record_desc: &str,
    record_detail: &str,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let model = SubtitleTaskRecordActiveModel {
        record_id: NotSet,
        task_id: Set(task_id),
        record_status: Set(record_status.to_string()),
        record_desc: Set(record_desc.to_string()),
        record_detail: Set(record_detail.to_string()),
        created_at: Set(now.clone()),
        updated_at: Set(now),
    };
    model.insert(db).await?;
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

pub async fn pause_subtitle_task_queue(
    _db: &DatabaseConnection,
) -> Result<SubtitleTaskQueuePauseRes> {
    // 仅用于队列暂停“意图”，不再中断当前 RUNNING 任务
    Ok(SubtitleTaskQueuePauseRes { ok: true })
}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTaskQueueResumeRes {
    pub ok: bool,
}

pub async fn resume_subtitle_task_queue(
    _db: &DatabaseConnection,
) -> Result<SubtitleTaskQueueResumeRes> {
    Ok(SubtitleTaskQueueResumeRes { ok: true })
}
