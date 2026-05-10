use crate::entity::{
    generated_subtitles::{Column as GenColumn, Entity as GenEntity},
    subtitle_task::{self, Column, Entity},
    subtitle_task_record::{Column as RecColumn, Entity as RecEntity},
};
use anyhow::{bail, Result};
use chrono::Utc;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, NotSet, PaginatorTrait,
    QueryFilter, QueryOrder, Set, TransactionTrait,
};
use serde::{Deserialize, Serialize};
use std::fmt;
use typeshare::typeshare;

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleTaskCreateReq {
    pub video_path: String,
}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTaskCreateRes {
    pub task_id: i32,
    pub task_status: String,
    pub video_path: String,
    pub created_at: String,
    pub updated_at: String,
}

fn default_list_page() -> i32 {
    1
}

fn default_list_page_size() -> i32 {
    20
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleTaskListReq {
    #[serde(default = "default_list_page")]
    pub page: i32,
    #[serde(default = "default_list_page_size")]
    pub page_size: i32,
    pub task_status: Option<String>,
    pub video_path_contains: Option<String>,
}

#[typeshare]
#[derive(Clone, Serialize)]
pub struct SubtitleTaskRow {
    pub task_id: i32,
    pub task_status: String,
    pub video_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTaskListRes {
    pub items: Vec<SubtitleTaskRow>,
    pub total: i32,
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleTaskDeleteReq {
    pub task_id: i32,
}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTaskDeleteRes {
    pub ok: bool,
}

enum SubtitleTaskStatus {
    // 待处理
    PENDING,
    // 处理中
    RUNNING,
    // 完成
    COMPLETED,
    // 失败
    FAILED,
}

impl fmt::Display for SubtitleTaskStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::PENDING => "PENDING",
            Self::RUNNING => "RUNNING",
            Self::COMPLETED => "COMPLETED",
            Self::FAILED => "FAILED",
        })
    }
}

pub async fn create_subtitle_task(
    db: &DatabaseConnection,
    req: SubtitleTaskCreateReq,
) -> Result<SubtitleTaskCreateRes> {
    let video_path = req.video_path.trim().to_string();
    if video_path.is_empty() {
        bail!("video_path 不能为空");
    }

    let now = Utc::now().to_rfc3339();

    let model = subtitle_task::ActiveModel {
        task_id: NotSet,
        task_status: Set(SubtitleTaskStatus::PENDING.to_string()),
        video_path: Set(video_path.clone()),
        created_at: Set(now.clone()),
        updated_at: Set(now.clone()),
    };

    let inserted = model.insert(db).await?;

    Ok(row_from_model(inserted))
}

fn row_from_model(m: subtitle_task::Model) -> SubtitleTaskCreateRes {
    SubtitleTaskCreateRes {
        task_id: m.task_id,
        task_status: m.task_status,
        video_path: m.video_path,
        created_at: m.created_at,
        updated_at: m.updated_at,
    }
}

pub async fn list_subtitle_tasks(
    db: &DatabaseConnection,
    req: SubtitleTaskListReq,
) -> Result<SubtitleTaskListRes> {
    let page = req.page.max(1) as u64;
    let page_size = (req.page_size.clamp(1, 100)) as u64;

    let mut q = Entity::find();
    if let Some(s) = req
        .task_status
        .as_ref()
        .map(|x| x.trim())
        .filter(|x| !x.is_empty())
    {
        q = q.filter(Column::TaskStatus.eq(s.to_string()));
    }
    if let Some(p) = req
        .video_path_contains
        .as_ref()
        .map(|x| x.trim())
        .filter(|x| !x.is_empty())
    {
        q = q.filter(Column::VideoPath.contains(p));
    }

    let paginator = q.order_by_desc(Column::TaskId).paginate(db, page_size);

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

pub async fn delete_subtitle_task(db: &DatabaseConnection, task_id: i32) -> Result<SubtitleTaskDeleteRes> {
    let task = Entity::find_by_id(task_id).one(db).await?;
    let Some(task) = task else {
        bail!("任务不存在");
    };
    if task.task_status == SubtitleTaskStatus::RUNNING.to_string() {
        bail!("处理中的任务不可删除");
    }

    let txn = db.begin().await?;

    RecEntity::delete_many()
        .filter(RecColumn::TaskId.eq(task_id))
        .exec(&txn)
        .await?;

    GenEntity::delete_many()
        .filter(GenColumn::TaskId.eq(task_id))
        .exec(&txn)
        .await?;

    let del = Entity::delete_by_id(task_id).exec(&txn).await?;
    if del.rows_affected == 0 {
        txn.rollback().await?;
        bail!("任务不存在");
    }

    txn.commit().await?;
    Ok(SubtitleTaskDeleteRes { ok: true })
}
