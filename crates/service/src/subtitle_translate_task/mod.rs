use anyhow::{Result, bail};
use chrono::Utc;

use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, NotSet, PaginatorTrait,
    QueryFilter, QueryOrder, Set, TransactionTrait,
};

use ma_db::entity::subtitle_translate_task::Column as SubtitleTranslateTaskColumn;
use ma_db::entity::subtitle_translate_task::Entity as SubtitleTranslateTaskEntity;
use ma_db::entity::subtitle_translate_task::Model as SubtitleTranslateTaskModel;

use ma_db::entity::subtitle_translate_task_record::Column as SubtitleTranslateTaskRecordColumn;
use ma_db::entity::subtitle_translate_task_record::Entity as SubtitleTranslateTaskRecordEntity;
use ma_db::entity::subtitle_translate_task_record::ActiveModel as SubtitleTranslateTaskRecordActiveModel;

pub mod types;
pub use types::*;

pub async fn create_subtitle_translate_task(
    db: &DatabaseConnection,
    req: SubtitleTranslateTaskCreateReq,
) -> Result<SubtitleTranslateTaskItem> {
    let source_srt_path = req.source_srt_path.trim().to_string();
    if source_srt_path.is_empty() {
        bail!("source_srt_path 不能为空");
    }
    let config_json = serde_json::to_string(&req.config)
        .map_err(|e| anyhow::anyhow!("序列化 config 失败: {}", e))?;

    let now = Utc::now().to_rfc3339();

    let model = ma_db::entity::subtitle_translate_task::ActiveModel {
        task_id: NotSet,
        task_status: Set(SubtitleTranslateTaskStatus::PENDING.to_string()),
        source_srt_path: Set(source_srt_path.clone()),
        config_json: Set(config_json),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
    };

    let inserted = model.insert(db).await?;

    Ok(row_from_model(inserted))
}

fn row_from_model(m: SubtitleTranslateTaskModel) -> SubtitleTranslateTaskItem {
    SubtitleTranslateTaskItem {
        task_id: m.task_id,
        task_status: m.task_status,
        source_srt_path: m.source_srt_path,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

pub async fn list_subtitle_translate_tasks(
    db: &DatabaseConnection,
    req: &SubtitleTranslateTaskListReq,
) -> Result<SubtitleTranslateTaskListRes> {
    let page = u64::from(req.current.max(1));
    let page_size = u64::from(req.page_size.clamp(1, 100));

    let mut q = SubtitleTranslateTaskEntity::find();
    if let Some(s) = req
        .task_status
        .as_ref()
        .map(|x| x.trim())
        .filter(|x| !x.is_empty())
    {
        q = q.filter(SubtitleTranslateTaskColumn::TaskStatus.eq(s.to_string()));
    }
    if let Some(p) = req
        .path_contains
        .as_ref()
        .map(|x| x.trim())
        .filter(|x| !x.is_empty())
    {
        q = q.filter(SubtitleTranslateTaskColumn::SourceSrtPath.contains(p));
    }

    let paginator = q
        .order_by_desc(SubtitleTranslateTaskColumn::TaskId)
        .paginate(db, page_size);

    let total = paginator.num_items().await? as i32;
    let models = paginator.fetch_page(page - 1).await?;

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

    Ok(SubtitleTranslateTaskListRes { items, total })
}

pub async fn delete_subtitle_translate_task(
    db: &DatabaseConnection,
    task_id: i32,
) -> Result<SubtitleTranslateTaskDeleteRes> {
    let task = SubtitleTranslateTaskEntity::find_by_id(task_id).one(db).await?;
    let Some(task) = task else {
        bail!("任务不存在");
    };
    if task.task_status == SubtitleTranslateTaskStatus::RUNNING.to_string() {
        bail!("处理中的任务不可删除");
    }

    let txn = db.begin().await?;

    SubtitleTranslateTaskRecordEntity::delete_many()
        .filter(SubtitleTranslateTaskRecordColumn::TaskId.eq(task_id))
        .exec(&txn)
        .await?;

    let del = SubtitleTranslateTaskEntity::delete_by_id(task_id).exec(&txn).await?;
    if del.rows_affected == 0 {
        txn.rollback().await?;
        bail!("任务不存在");
    }

    txn.commit().await?;
    Ok(SubtitleTranslateTaskDeleteRes { ok: true })
}

pub async fn retry_subtitle_translate_task(
    db: &DatabaseConnection,
    task_id: i32,
) -> Result<SubtitleTranslateTaskRetryRes> {
    let task = SubtitleTranslateTaskEntity::find_by_id(task_id).one(db).await?;
    let Some(task) = task else {
        bail!("任务不存在");
    };
    if task.task_status != SubtitleTranslateTaskStatus::FAILED.to_string() {
        bail!("仅失败任务可重新开始");
    }

    let txn = db.begin().await?;

    SubtitleTranslateTaskRecordEntity::delete_many()
        .filter(SubtitleTranslateTaskRecordColumn::TaskId.eq(task_id))
        .exec(&txn)
        .await?;

    let now = Utc::now().to_rfc3339();
    let res = SubtitleTranslateTaskEntity::update_many()
        .col_expr(
            SubtitleTranslateTaskColumn::TaskStatus,
            sea_orm::sea_query::Expr::value(SubtitleTranslateTaskStatus::PENDING.to_string()),
        )
        .col_expr(
            SubtitleTranslateTaskColumn::UpdatedAt,
            sea_orm::sea_query::Expr::value(now),
        )
        .filter(SubtitleTranslateTaskColumn::TaskId.eq(task_id))
        .exec(&txn)
        .await?;

    if res.rows_affected == 0 {
        txn.rollback().await?;
        bail!("任务不存在");
    }

    txn.commit().await?;
    Ok(SubtitleTranslateTaskRetryRes { ok: true })
}

pub async fn get_subtitle_translate_task(
    db: &DatabaseConnection,
    task_id: i32,
) -> Result<SubtitleTranslateTaskModel> {
    let task = SubtitleTranslateTaskEntity::find_by_id(task_id).one(db).await?;
    task.ok_or_else(|| anyhow::anyhow!("任务不存在"))
}

pub async fn set_subtitle_translate_task_status(
    db: &DatabaseConnection,
    task_id: i32,
    status: &str,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let res = SubtitleTranslateTaskEntity::update_many()
        .col_expr(
            SubtitleTranslateTaskColumn::TaskStatus,
            sea_orm::sea_query::Expr::value(status.to_string()),
        )
        .col_expr(
            SubtitleTranslateTaskColumn::UpdatedAt,
            sea_orm::sea_query::Expr::value(now),
        )
        .filter(SubtitleTranslateTaskColumn::TaskId.eq(task_id))
        .exec(db)
        .await?;
    if res.rows_affected == 0 {
        bail!("任务不存在");
    }
    Ok(())
}

pub async fn append_translate_task_record(
    db: &DatabaseConnection,
    task_id: i32,
    record_status: &str,
    record_desc: &str,
    record_detail: &str,
) -> Result<()> {
    let now = Utc::now().to_rfc3339();
    let model = SubtitleTranslateTaskRecordActiveModel {
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

pub async fn pause_subtitle_translate_task_queue(
    _db: &DatabaseConnection,
) -> Result<SubtitleTranslateTaskQueuePauseRes> {
    Ok(SubtitleTranslateTaskQueuePauseRes { ok: true })
}

pub async fn resume_subtitle_translate_task_queue(
    _db: &DatabaseConnection,
) -> Result<SubtitleTranslateTaskQueueResumeRes> {
    Ok(SubtitleTranslateTaskQueueResumeRes { ok: true })
}
