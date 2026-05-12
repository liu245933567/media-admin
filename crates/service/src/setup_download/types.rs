use serde::{Deserialize, Serialize};
use typeshare::typeshare;

/// Whisper 可下载项（静态目录）
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperModelItem {
    pub id: String,
    pub label: String,
    pub filename: String,
    pub description: String,
    /// 人类可读大小，如 "3.1 GiB"
    pub size_hint: String,
    /// 模型目录下是否已有同名文件
    pub local_ready: bool,
}

#[typeshare]
#[derive(Debug, Serialize, Deserialize)]
pub struct WhisperModelsListRes {
    pub items: Vec<WhisperModelItem>,
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct WhisperDownloadStartReq {
    pub model_id: String,
}

#[typeshare]
#[derive(Debug, Serialize)]
pub struct DownloadJobStartRes {
    pub job_id: String,
}

#[typeshare]
#[derive(Debug, Deserialize)]
pub struct FfmpegDownloadStartReq {}

/// FFmpeg 工具目录是否已安装可执行文件
#[typeshare]
#[derive(Debug, Serialize, Deserialize)]
pub struct FfmpegSetupStatusRes {
    pub local_ready: bool,
}

/// SSE / 内部共用的进度快照（JSON）
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadProgressSnapshot {
    pub phase: String,
    pub bytes_received: f64,
    pub bytes_total: Option<f64>,
    pub message: String,
}

impl Default for DownloadProgressSnapshot {
    fn default() -> Self {
        Self {
            phase: "pending".into(),
            bytes_received: 0.0,
            bytes_total: None,
            message: String::new(),
        }
    }
}
