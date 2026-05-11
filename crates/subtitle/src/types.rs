use ma_whisper::types::{VadConfig, WhisperEngineConfig, WhisperTranscribeOptions};
use serde::{Deserialize, Serialize};
use typeshare::typeshare;

/// 翻译选项
#[typeshare]
#[derive(Serialize, Deserialize)]
pub struct SubtitleTranslateConfig {
    /// 模型名，默认 `tencent/Hunyuan-MT-7B`
    pub model: String,
    /// 目标语言，例如 "Chinese"、"English"、"Japanese"
    pub target_language: String,
    /// 并发数（同时在飞的请求数）
    pub concurrency: i32,
    /// 单批字幕条数。`>1` 时启用批量上下文翻译，`=1` 走逐条翻译。
    pub batch_size: i32,
    /// 是否在翻译完成后删除原文 SRT。默认 `false`，两份文件并存便于核对。
    pub remove_source_srt: bool,
}

impl Default for SubtitleTranslateConfig {
    fn default() -> Self {
        Self {
            model: "tencent/Hunyuan-MT-7B".to_string(),
            target_language: "Chinese".to_string(),
            concurrency: 4,
            batch_size: 8,
            remove_source_srt: false,
        }
    }
}

/// 字幕生成结果项
#[derive(Serialize)]

pub struct SubtitleGenerateItem {
    pub srt_path: String,
}

#[typeshare]
#[derive(Serialize, Deserialize)]
pub struct SubtitleGenerateConfig {
    pub video_path: String,
    pub vad_config: Option<VadConfig>,
    pub whisper_engine_cfg: Option<WhisperEngineConfig>,
    pub whisper_transcribe_options: Option<WhisperTranscribeOptions>,
    pub translate_cfg: Option<SubtitleTranslateConfig>,
}
