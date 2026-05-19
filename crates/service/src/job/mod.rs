//! Taskmill 媒体任务：视频字幕生成与字幕翻译（SQLite 持久化，与业务 DB 分离）。

mod control;
mod setup_download_exec;
mod spawn;
mod storage;
mod submit;
mod types;

pub use control::{
    TaskmillCancelRes, TaskmillControlOk, TaskmillDeleteHistoryRes,
};
pub use spawn::spawn_taskmill_scheduler;
pub use storage::{TaskmillRuntime, TaskmillSnapshot, TimestampedSchedulerEvent};
pub use taskmill::TaskRecord;
pub use submit::{
    SubtitleGenerateBulkFailedItem, SubtitleGenerateBulkReq, SubtitleGenerateBulkRes,
    SubtitleGenerateDefaultsRes, SubtitleGenerateReq, SubtitleTranslateJobReq,
    bulk_enqueue_subtitle_generate, enqueue_subtitle_generate, enqueue_subtitle_translate_req,
    subtitle_generate_defaults,
};
pub use ma_subtitle::types::SubtitleGenerateConfig;
pub use taskmill::TaskHistoryRecord;
pub use types::{
    ExtractWavTask, FfmpegSetupDownloadTask, MediaJobsDomain, SubtitleTranslateJob,
    VideoSubtitleGenerateTask, WhisperModelDownloadTask, WhisperVadSrtTask, GROUP_FFMPEG,
    GROUP_SETUP_DOWNLOAD, GROUP_TRANSLATE, GROUP_WHISPER,
};
