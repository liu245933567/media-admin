//! Taskmill 媒体任务域：视频字幕生成与字幕翻译。

use std::collections::HashMap;

use ma_subtitle::types::{SubtitleGenerateConfig, SubtitleTranslateConfig};
use serde::{Deserialize, Serialize};
use taskmill::{DomainKey, DuplicateStrategy, IoBudget, Priority, TaskTypeConfig, TypedTask};
use typeshare::typeshare;

#[derive(Debug, Clone, Copy)]
pub struct MediaJobsDomain;

impl DomainKey for MediaJobsDomain {
    const NAME: &'static str = "media-jobs";
}

/// 视频字幕生成任务载荷（包装 `SubtitleGenerateConfig` 以满足 TypedTask 孤儿规则）。
#[derive(Clone, Serialize, Deserialize)]
pub struct VideoSubtitleGenerateTask(pub SubtitleGenerateConfig);

impl std::fmt::Debug for VideoSubtitleGenerateTask {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VideoSubtitleGenerateTask")
            .field("video_path", &self.0.video_path)
            .finish()
    }
}

impl TypedTask for VideoSubtitleGenerateTask {
    type Domain = MediaJobsDomain;

    const TASK_TYPE: &'static str = "video-subtitle-generate";

    fn config() -> TaskTypeConfig {
        TaskTypeConfig::new()
            .priority(Priority::NORMAL)
            .expected_io(IoBudget::disk(32 * 1024 * 1024, 16 * 1024 * 1024))
            .on_duplicate(DuplicateStrategy::Skip)
    }

    fn key(&self) -> Option<String> {
        let path = self.0.video_path.trim();
        if path.is_empty() {
            None
        } else {
            Some(format!("video-subtitle-generate:{path}"))
        }
    }

    fn label(&self) -> Option<String> {
        let path = self.0.video_path.trim();
        if path.is_empty() {
            None
        } else {
            Some(format!("字幕生成: {path}"))
        }
    }

    fn tags(&self) -> HashMap<String, String> {
        HashMap::from([(
            "job.kind".to_string(),
            "video-subtitle-generate".to_string(),
        )])
    }
}

/// 字幕翻译任务（可独立提交，或由生成任务链式入队）。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitleTranslateJob {
    pub source_srt_path: String,
    pub config: SubtitleTranslateConfig,
}

impl TypedTask for SubtitleTranslateJob {
    type Domain = MediaJobsDomain;

    const TASK_TYPE: &'static str = "subtitle-translate";

    fn config() -> TaskTypeConfig {
        TaskTypeConfig::new()
            .priority(Priority::NORMAL)
            .expected_io(IoBudget::disk(512 * 1024, 512 * 1024))
            .on_duplicate(DuplicateStrategy::Skip)
    }

    fn key(&self) -> Option<String> {
        let path = self.source_srt_path.trim();
        let lang = self.config.target_language.trim();
        if path.is_empty() {
            None
        } else {
            Some(format!("subtitle-translate:{path}:{lang}"))
        }
    }

    fn label(&self) -> Option<String> {
        Some(format!(
            "字幕翻译: {} -> {}",
            self.source_srt_path, self.config.target_language
        ))
    }

    fn tags(&self) -> HashMap<String, String> {
        HashMap::from([
            ("job.kind".to_string(), "subtitle-translate".to_string()),
            (
                "job.target_language".to_string(),
                self.config.target_language.clone(),
            ),
        ])
    }
}
