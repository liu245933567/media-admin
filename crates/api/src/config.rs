use ma_service::{
    SubtitleTranslateConfig, VadConfig, WhisperEngineConfig, WhisperTranscribeConfig,
};

use serde::{Deserialize, Serialize};
use typeshare::typeshare;

/// 应用配置
#[typeshare]
#[derive(Clone, Serialize, Deserialize)]
/// 应用设置
pub struct AppConfig {
    pub vad_config: VadConfig,
    pub whisper_engine_config: WhisperEngineConfig,
    pub whisper_transcribe_config: WhisperTranscribeConfig,
    pub translate_config: SubtitleTranslateConfig,
}
