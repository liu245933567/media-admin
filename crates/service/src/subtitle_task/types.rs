use ma_subtitle::types::SubtitleGenerateConfig;
use serde::{Deserialize, Serialize};
use typeshare::typeshare;

#[typeshare]
#[derive(Deserialize)]
pub struct SubtitleTaskCreateReq {
    pub config: SubtitleGenerateConfig,
}

#[typeshare]
#[derive(Deserialize)]
pub struct SubtitleTaskBulkCreateReq {
    pub configs: Vec<SubtitleGenerateConfig>,
    /// 若同 video_path 已存在 PENDING/RUNNING 任务则跳过（默认 true）
    pub skip_if_exists: Option<bool>,
}

#[typeshare]
#[derive(Clone, Serialize)]
pub struct SubtitleTaskBulkCreateFailedItem {
    pub video_path: String,
    pub error: String,
}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTaskBulkCreateRes {
    pub created: Vec<SubtitleTaskItem>,
    pub skipped: Vec<String>,
    pub failed: Vec<SubtitleTaskBulkCreateFailedItem>,
}

/// 字幕任务列表 - 返回给前端
#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTaskItem {
    pub task_id: i32,
    pub task_status: String,
    pub video_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleTaskListReq {
    pub current: u64,
    pub page_size: u64,
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

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleTaskQueueResumeReq {}

pub enum SubtitleTaskStatus {
    // 待处理
    PENDING,
    // 处理中
    RUNNING,
    // 完成
    COMPLETED,
    // 失败
    FAILED,
}

impl std::fmt::Display for SubtitleTaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::PENDING => "PENDING",
            Self::RUNNING => "RUNNING",
            Self::COMPLETED => "COMPLETED",
            Self::FAILED => "FAILED",
        })
    }
}
