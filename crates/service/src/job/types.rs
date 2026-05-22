//! Taskmill 媒体任务域：视频字幕生成与字幕翻译。

use std::collections::HashMap;

use ma_subtitle::types::{SubtitleGenerateConfig, SubtitleTranslateConfig};
use serde::{Deserialize, Serialize};
use taskmill::{DomainKey, DuplicateStrategy, IoBudget, Priority, TaskTypeConfig, TypedTask};
use typeshare::{I54, typeshare};

#[derive(Debug, Clone, Copy)]
pub struct MediaJobsDomain;

impl DomainKey for MediaJobsDomain {
    const NAME: &'static str = "media-jobs";
}

/// Taskmill 资源组：字幕生成流水线（含 FFmpeg + Whisper，GPU 全局互斥）。
pub const GROUP_WHISPER: &str = "media:whisper";
/// Taskmill 资源组：字幕翻译 API 调用。
pub const GROUP_TRANSLATE: &str = "media:translate";
/// Taskmill 资源组：设置页下载（模型 / FFmpeg，全局串行）。
pub const GROUP_SETUP_DOWNLOAD: &str = "media:setup-download";
/// Taskmill 资源组：媒体库文件扫描（磁盘递归 IO）。
pub const GROUP_MEDIA_SCAN: &str = "media:scan";

/// 视频字幕生成任务载荷（`config` 为识别/翻译参数，`video_path` 单独携带）。
#[derive(Clone, Serialize, Deserialize)]
pub struct VideoSubtitleGenerateTask {
    pub video_path: String,
    pub config: SubtitleGenerateConfig,
}

/// 扫描媒体资源根目录并将视频/字幕文件写入业务库。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
/// 扫描媒体资源根目录并将视频/字幕文件写入业务库。
pub struct MediaLibraryScanTask {
    pub root_id: I54,
    pub root_path: String,
}

impl TypedTask for MediaLibraryScanTask {
    type Domain = MediaJobsDomain;

    const TASK_TYPE: &'static str = "media-library-scan";

    fn config() -> TaskTypeConfig {
        TaskTypeConfig::new()
            .priority(Priority::NORMAL)
            .expected_io(IoBudget::disk(64 * 1024 * 1024, 64 * 1024 * 1024))
            .group(GROUP_MEDIA_SCAN)
            .on_duplicate(DuplicateStrategy::Skip)
    }

    fn key(&self) -> Option<String> {
        if i64::from(self.root_id) <= 0 {
            None
        } else {
            Some(format!("media-library-scan:{}", self.root_id))
        }
    }

    fn label(&self) -> Option<String> {
        Some(format!("扫描媒体资源: {}", self.root_path))
    }

    fn tags(&self) -> HashMap<String, String> {
        HashMap::from([
            ("job.kind".to_string(), "media-library-scan".to_string()),
            ("media.root_id".to_string(), self.root_id.to_string()),
        ])
    }
}

impl std::fmt::Debug for VideoSubtitleGenerateTask {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VideoSubtitleGenerateTask")
            .field("video_path", &self.video_path)
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
            .group(GROUP_WHISPER)
            .on_duplicate(DuplicateStrategy::Skip)
    }

    fn key(&self) -> Option<String> {
        let path = self.video_path.trim();
        if path.is_empty() {
            None
        } else {
            Some(format!("video-subtitle-generate:{path}"))
        }
    }

    fn label(&self) -> Option<String> {
        let path = self.video_path.trim();
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

/// 字幕翻译任务（可独立提交，或由 [`VideoSubtitleGenerateTask`] 完成后异步入队，不阻塞生成任务）。
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
            .group(GROUP_TRANSLATE)
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

/// 下载 Whisper 模型到本地模型目录。
#[derive(Clone, Serialize, Deserialize)]
pub struct WhisperModelDownloadTask {
    pub model_id: String,
}

impl std::fmt::Debug for WhisperModelDownloadTask {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WhisperModelDownloadTask")
            .field("model_id", &self.model_id)
            .finish()
    }
}

impl TypedTask for WhisperModelDownloadTask {
    type Domain = MediaJobsDomain;

    const TASK_TYPE: &'static str = "whisper-model-download";

    fn config() -> TaskTypeConfig {
        TaskTypeConfig::new()
            .priority(Priority::HIGH)
            .expected_io(IoBudget::disk(512 * 1024 * 1024, 512 * 1024 * 1024))
            .group(GROUP_SETUP_DOWNLOAD)
            .on_duplicate(DuplicateStrategy::Skip)
    }

    fn key(&self) -> Option<String> {
        let id = self.model_id.trim();
        if id.is_empty() {
            None
        } else {
            Some(format!("whisper-model-download:{id}"))
        }
    }

    fn label(&self) -> Option<String> {
        Some(format!("下载 Whisper 模型: {}", self.model_id))
    }

    fn tags(&self) -> HashMap<String, String> {
        HashMap::from([(
            "job.kind".to_string(),
            "whisper-model-download".to_string(),
        )])
    }
}

/// 下载并安装 FFmpeg 到工具目录。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FfmpegSetupDownloadTask;

impl TypedTask for FfmpegSetupDownloadTask {
    type Domain = MediaJobsDomain;

    const TASK_TYPE: &'static str = "ffmpeg-setup-download";

    fn config() -> TaskTypeConfig {
        TaskTypeConfig::new()
            .priority(Priority::HIGH)
            .expected_io(IoBudget::disk(256 * 1024 * 1024, 128 * 1024 * 1024))
            .group(GROUP_SETUP_DOWNLOAD)
            .on_duplicate(DuplicateStrategy::Skip)
    }

    fn key(&self) -> Option<String> {
        Some("ffmpeg-setup-download".to_string())
    }

    fn label(&self) -> Option<String> {
        Some("下载 FFmpeg".to_string())
    }

    fn tags(&self) -> HashMap<String, String> {
        HashMap::from([("job.kind".to_string(), "ffmpeg-setup-download".to_string())])
    }
}
