//! Taskmill 演示任务载荷（占位路径，无真实业务）。

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use taskmill::{DomainKey, DuplicateStrategy, IoBudget, Priority, TaskTypeConfig, TypedTask};

#[derive(Debug, Clone, Copy)]
pub struct TaskmillDemoDomain;

impl DomainKey for TaskmillDemoDomain {
    const NAME: &'static str = "taskmill-demo";
}

/// 视频字幕流水线入口：从视频路径开始。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoSubtitlePipelineInput {
    pub video_path: String,
}

impl TypedTask for VideoSubtitlePipelineInput {
    type Domain = TaskmillDemoDomain;

    const TASK_TYPE: &'static str = "video-pipeline";

    fn config() -> TaskTypeConfig {
        TaskTypeConfig::new()
            .priority(Priority::NORMAL)
            .expected_io(IoBudget::disk(16 * 1024 * 1024, 8 * 1024 * 1024))
            .on_duplicate(DuplicateStrategy::Skip)
    }

    fn key(&self) -> Option<String> {
        Some(format!("video-pipeline:{}", self.video_path))
    }

    fn label(&self) -> Option<String> {
        Some(format!("视频流水线: {}", self.video_path))
    }

    fn tags(&self) -> HashMap<String, String> {
        HashMap::from([("demo.kind".to_string(), "video-pipeline".to_string())])
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AfterExtractWav {
    pub video_path: String,
    pub wav_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AfterTranscribe {
    pub video_path: String,
    pub wav_path: String,
    pub subtitle_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AfterTranslate {
    pub video_path: String,
    pub wav_path: String,
    pub subtitle_path: String,
    pub translated_subtitle_path: String,
}

/// 仅「翻译字幕」任务入口。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranslateSubtitleOnlyInput {
    pub subtitle_path: String,
    pub target_lang: String,
}

impl TypedTask for TranslateSubtitleOnlyInput {
    type Domain = TaskmillDemoDomain;

    const TASK_TYPE: &'static str = "translate-subtitle";

    fn config() -> TaskTypeConfig {
        TaskTypeConfig::new()
            .priority(Priority::NORMAL)
            .expected_io(IoBudget::disk(512 * 1024, 512 * 1024))
            .on_duplicate(DuplicateStrategy::Skip)
    }

    fn key(&self) -> Option<String> {
        Some(format!(
            "translate-subtitle:{}:{}",
            self.subtitle_path, self.target_lang
        ))
    }

    fn label(&self) -> Option<String> {
        Some(format!(
            "翻译字幕: {} -> {}",
            self.subtitle_path, self.target_lang
        ))
    }

    fn tags(&self) -> HashMap<String, String> {
        HashMap::from([
            ("demo.kind".to_string(), "translate-subtitle".to_string()),
            ("demo.target_lang".to_string(), self.target_lang.clone()),
        ])
    }
}
