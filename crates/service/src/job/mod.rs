//! Taskmill 演示：SQLite 持久化调度器（与业务 DB 分离）。
//!
//! 任务逻辑按 typed task + executor 拆分：视频流水线 executor 顺序调用多个占位步骤，
//! 仅翻译 executor 保持单步占位，用于验证 Taskmill 提交、调度、进度与快照能力。

mod spawn;
mod storage;
mod translate_only;
mod types;
mod video_pipeline;

pub use spawn::spawn_taskmill_demo_scheduler;
pub use storage::{TaskmillDemo, TaskmillDemoSnapshot};
pub use translate_only::TRANSLATE_ONLY_QUEUE;
pub use types::{
    AfterExtractWav, AfterTranscribe, AfterTranslate, TaskmillDemoDomain,
    TranslateSubtitleOnlyInput, VideoSubtitlePipelineInput,
};
pub use video_pipeline::VIDEO_PIPELINE_QUEUE;
