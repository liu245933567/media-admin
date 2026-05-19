//! Taskmill 媒体任务域：视频字幕生成与字幕翻译。

use std::collections::HashMap;

use ma_subtitle::types::{SubtitleGenerateConfig, SubtitleTranslateConfig};
use ma_whisper::types::{VadConfig, WhisperEngineConfig, WhisperTranscribeConfig};
use serde::{Deserialize, Serialize};
use taskmill::{DomainKey, DuplicateStrategy, IoBudget, Priority, TaskTypeConfig, TypedTask};
use typeshare::typeshare;

#[derive(Debug, Clone, Copy)]
pub struct MediaJobsDomain;

impl DomainKey for MediaJobsDomain {
    const NAME: &'static str = "media-jobs";
}

/// Taskmill 资源组：FFmpeg 提取 WAV（可并行多个视频）。
pub const GROUP_FFMPEG: &str = "media:ffmpeg";
/// Taskmill 资源组：Whisper 识别（GPU，全局互斥）。
pub const GROUP_WHISPER: &str = "media:whisper";
/// Taskmill 资源组：字幕翻译 API 调用。
pub const GROUP_TRANSLATE: &str = "media:translate";
/// Taskmill 资源组：设置页下载（模型 / FFmpeg，全局串行）。
pub const GROUP_SETUP_DOWNLOAD: &str = "media:setup-download";

/// 视频字幕生成任务载荷（`config` 为识别/翻译参数，`video_path` 单独携带）。
#[derive(Clone, Serialize, Deserialize)]
pub struct VideoSubtitleGenerateTask {
    pub video_path: String,
    pub config: SubtitleGenerateConfig,
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

/// 从视频提取 16kHz mono WAV（流水线子任务 1）。
#[derive(Clone, Serialize, Deserialize)]
pub struct ExtractWavTask {
    pub video_path: String,
    pub vad_config: Option<VadConfig>,
    pub whisper_engine_config: Option<WhisperEngineConfig>,
    pub whisper_transcribe_config: Option<WhisperTranscribeConfig>,
    pub translate_config: Option<SubtitleTranslateConfig>,
}

impl ExtractWavTask {
    /// 由根任务的视频路径与生成配置构造子任务载荷。
    pub fn from_video_config(video_path: impl Into<String>, config: &SubtitleGenerateConfig) -> Self {
        Self {
            video_path: video_path.into(),
            vad_config: config.vad_config.clone(),
            whisper_engine_config: config.whisper_engine_config.clone(),
            whisper_transcribe_config: config.whisper_transcribe_config.clone(),
            translate_config: config.translate_config.clone(),
        }
    }
}

impl std::fmt::Debug for ExtractWavTask {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ExtractWavTask")
            .field("video_path", &self.video_path)
            .finish()
    }
}

impl TypedTask for ExtractWavTask {
    type Domain = MediaJobsDomain;

    const TASK_TYPE: &'static str = "extract-wav";

    fn config() -> TaskTypeConfig {
        TaskTypeConfig::new()
            .priority(Priority::NORMAL)
            .expected_io(IoBudget::disk(24 * 1024 * 1024, 8 * 1024 * 1024))
            .group(GROUP_FFMPEG)
            .on_duplicate(DuplicateStrategy::Skip)
    }

    fn key(&self) -> Option<String> {
        let path = self.video_path.trim();
        if path.is_empty() {
            None
        } else {
            Some(format!("extract-wav:{path}"))
        }
    }

    fn label(&self) -> Option<String> {
        Some(format!("提取 WAV: {}", self.video_path))
    }

    fn tags(&self) -> HashMap<String, String> {
        HashMap::from([("job.kind".to_string(), "extract-wav".to_string())])
    }
}

/// VAD 切分 + Whisper 识别 + 写 SRT（流水线子任务 2）。
#[derive(Clone, Serialize, Deserialize)]
pub struct WhisperVadSrtTask {
    pub video_path: String,
    pub wav_path: String,
    pub vad_config: Option<VadConfig>,
    pub whisper_engine_config: Option<WhisperEngineConfig>,
    pub whisper_transcribe_config: Option<WhisperTranscribeConfig>,
    pub translate_config: Option<SubtitleTranslateConfig>,
}

impl std::fmt::Debug for WhisperVadSrtTask {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WhisperVadSrtTask")
            .field("video_path", &self.video_path)
            .field("wav_path", &self.wav_path)
            .finish()
    }
}

impl TypedTask for WhisperVadSrtTask {
    type Domain = MediaJobsDomain;

    const TASK_TYPE: &'static str = "whisper-vad-srt";

    fn config() -> TaskTypeConfig {
        TaskTypeConfig::new()
            .priority(Priority::NORMAL)
            .expected_io(IoBudget::disk(8 * 1024 * 1024, 4 * 1024 * 1024))
            .group(GROUP_WHISPER)
            .on_duplicate(DuplicateStrategy::Skip)
    }

    fn key(&self) -> Option<String> {
        let path = self.video_path.trim();
        if path.is_empty() {
            None
        } else {
            Some(format!("whisper-vad-srt:{path}"))
        }
    }

    fn label(&self) -> Option<String> {
        Some(format!("识别字幕: {}", self.video_path))
    }

    fn tags(&self) -> HashMap<String, String> {
        HashMap::from([("job.kind".to_string(), "whisper-vad-srt".to_string())])
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
