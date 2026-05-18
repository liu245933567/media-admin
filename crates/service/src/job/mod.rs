//! Taskmill 媒体任务：视频字幕生成与字幕翻译（SQLite 持久化，与业务 DB 分离）。

mod spawn;
mod storage;
mod submit;
mod types;

pub use spawn::spawn_taskmill_scheduler;
pub use storage::{TaskmillRuntime, TaskmillSnapshot, TimestampedSchedulerEvent};
pub use submit::{
    SubtitleGenerateBulkFailedItem, SubtitleGenerateBulkReq, SubtitleGenerateBulkRes,
    SubtitleGenerateDefaultsRes, SubtitleGenerateReq, bulk_enqueue_subtitle_generate,
    enqueue_subtitle_generate, subtitle_generate_defaults,
};
pub use ma_subtitle::types::SubtitleGenerateConfig;
pub use taskmill::TaskHistoryRecord;
pub use types::{
    ExtractWavTask, MediaJobsDomain, SubtitleTranslateJob, VideoSubtitleGenerateTask,
    WhisperVadSrtTask, GROUP_FFMPEG, GROUP_TRANSLATE, GROUP_WHISPER,
};
