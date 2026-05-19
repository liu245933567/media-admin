pub(crate) mod catalog;
pub(crate) mod ffmpeg;
pub(crate) mod progress;
pub(crate) mod staging;
mod status;
pub mod submit;
mod types;
pub(crate) mod whisper;

pub use catalog::whisper_catalog;
pub use status::{ffmpeg_setup_status, list_whisper_models};
pub use submit::{
    enqueue_ffmpeg_setup_download, enqueue_whisper_model_download, submit_outcome_task_id,
};
pub use types::{
    DownloadJobStartRes, DownloadProgressSnapshot, FfmpegDownloadStartReq, FfmpegSetupStatusRes,
    WhisperDownloadStartReq, WhisperModelItem, WhisperModelsListRes,
};
