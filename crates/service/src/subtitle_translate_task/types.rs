use ma_subtitle::types::SubtitleTranslateConfig;
use serde::{Deserialize, Serialize};
use typeshare::typeshare;

#[typeshare]
#[derive(Deserialize)]
pub struct SubtitleTranslateTaskCreateReq {
    pub source_srt_path: String,
    pub config: SubtitleTranslateConfig,
}

#[typeshare]
#[derive(Clone, Serialize)]
pub struct SubtitleTranslateTaskItem {
    pub task_id: i32,
    pub task_status: String,
    pub source_srt_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleTranslateTaskListReq {
    pub current: u32,
    pub page_size: u32,
    pub task_status: Option<String>,
    pub path_contains: Option<String>,
}

#[typeshare]
#[derive(Clone, Serialize)]
pub struct SubtitleTranslateTaskRow {
    pub task_id: i32,
    pub task_status: String,
    pub source_srt_path: String,
    pub created_at: String,
    pub updated_at: String,
}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTranslateTaskListRes {
    pub items: Vec<SubtitleTranslateTaskRow>,
    pub total: i32,
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleTranslateTaskDeleteReq {
    pub task_id: i32,
}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTranslateTaskDeleteRes {
    pub ok: bool,
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleTranslateTaskRetryReq {
    pub task_id: i32,
}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTranslateTaskRetryRes {
    pub ok: bool,
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleTranslateTaskQueuePauseReq {}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTranslateTaskQueuePauseRes {
    pub ok: bool,
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleTranslateTaskQueueResumeReq {}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTranslateTaskQueueResumeRes {
    pub ok: bool,
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct SubtitleTranslateTaskQueueStatusReq {}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleTranslateTaskQueueStatusRes {
    pub status: String,
}

pub enum SubtitleTranslateTaskStatus {
    PENDING,
    RUNNING,
    COMPLETED,
    FAILED,
}

impl std::fmt::Display for SubtitleTranslateTaskStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::PENDING => "PENDING",
            Self::RUNNING => "RUNNING",
            Self::COMPLETED => "COMPLETED",
            Self::FAILED => "FAILED",
        })
    }
}
