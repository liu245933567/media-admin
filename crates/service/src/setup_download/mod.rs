mod catalog;
mod ffmpeg;
mod staging;
pub mod state;
mod types;
mod whisper;

pub use catalog::whisper_catalog;
pub use state::{SetupDownloadState, parse_job_id};
pub use types::{
    DownloadJobStartRes, DownloadProgressSnapshot, FfmpegDownloadStartReq, FfmpegSetupStatusRes,
    WhisperDownloadStartReq, WhisperModelItem, WhisperModelsListRes,
};
