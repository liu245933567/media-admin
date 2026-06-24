//! 应用级默认配置（VAD / Whisper / 翻译 / Stash），与 [`ma_subtitle::types::SubtitleGenerateConfig`] 对应但各块为必填，便于持久化与表单「全局默认值」。
use crate::{emby::EmbyConnectConfig, stash::StashConnectConfig};
use ma_subtitle::types::{SubtitleGenerateConfig, SubtitleTranslateConfig};
use ma_whisper::engine_cache::{clear_engine_cache, engine_pool_size, set_engine_pool_size};
use ma_whisper::types::{VadConfig, WhisperEngineConfig, WhisperTranscribeConfig};
use serde::{Deserialize, Serialize};
use typeshare::typeshare;
use utoipa::ToSchema;

/// 应用设置：识别流水线默认参数 + 翻译默认参数 + Stash / Emby 连接。
#[typeshare]
#[derive(Clone, Serialize, Deserialize, ToSchema)]

pub struct AppConfig {
    pub vad_config: VadConfig,
    pub whisper_engine_config: WhisperEngineConfig,
    /// 同一 Whisper 模型配置可同时保留的引擎实例数。
    #[serde(default = "default_whisper_engine_pool_size")]
    pub whisper_engine_pool_size: usize,
    pub whisper_transcribe_config: WhisperTranscribeConfig,
    pub translate_config: SubtitleTranslateConfig,
    /// 旧版 `app_config.json` 无此字段时反序列化为 [`StashConnectConfig::default`]。
    #[serde(default)]
    pub stash_config: StashConnectConfig,
    /// 旧版 `app_config.json` 无此字段时反序列化为 [`EmbyConnectConfig::default`]。
    #[serde(default)]
    pub emby_config: EmbyConnectConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self::from_generate_defaults()
    }
}

impl AppConfig {
    /// 由 [`SubtitleGenerateConfig::default`] 展开得到初始持久化内容。
    pub fn from_generate_defaults() -> Self {
        let g = SubtitleGenerateConfig::default();

        Self {
            vad_config: g.vad_config.unwrap_or_default(),
            whisper_engine_config: g.whisper_engine_config.unwrap_or_default(),
            whisper_engine_pool_size: default_whisper_engine_pool_size(),
            whisper_transcribe_config: g.whisper_transcribe_config.unwrap_or_default(),
            translate_config: g.translate_config.unwrap_or_default(),
            stash_config: StashConnectConfig::default(),
            emby_config: EmbyConnectConfig::default(),
        }
    }
}

fn default_whisper_engine_pool_size() -> usize {
    engine_pool_size()
}

/// 应用全局配置生效到 Whisper 运行时；池大小变化时清空旧池以便新任务使用新配置。
pub fn apply_whisper_runtime_config(previous: Option<&AppConfig>, current: &AppConfig) {
    let pool_size = current.whisper_engine_pool_size.max(1);
    set_engine_pool_size(pool_size);
    if previous.is_some_and(|old| old.whisper_engine_pool_size.max(1) != pool_size) {
        clear_engine_cache();
    }
}

/// 将全局配置展开为「新建字幕任务」表单的基准结构（各子配置均为 `Some`）。

pub fn app_config_to_generate_defaults(global: &AppConfig) -> SubtitleGenerateConfig {
    SubtitleGenerateConfig {
        vad_config: Some(global.vad_config.clone()),
        whisper_engine_config: Some(global.whisper_engine_config.clone()),
        whisper_transcribe_config: Some(global.whisper_transcribe_config.clone()),
        translate_config: Some(global.translate_config.clone()),
    }
}

/// 合并任务请求中的部分配置与全局默认。
///
/// - `req_config == None`：整包采用 [`app_config_to_generate_defaults`]。
/// - 子块为 `None`：该块采用全局对应块。
/// - `translate_config == None`：本任务不链式翻译（与「子块继承」区分）。

pub fn merge_subtitle_generate_config(
    req_config: Option<SubtitleGenerateConfig>,
    global: &AppConfig,
) -> SubtitleGenerateConfig {
    let partial = match req_config {
        None => return app_config_to_generate_defaults(global),
        Some(c) => c,
    };
    SubtitleGenerateConfig {
        vad_config: partial
            .vad_config
            .or_else(|| Some(global.vad_config.clone())),
        whisper_engine_config: partial
            .whisper_engine_config
            .or_else(|| Some(global.whisper_engine_config.clone())),
        whisper_transcribe_config: partial
            .whisper_transcribe_config
            .or_else(|| Some(global.whisper_transcribe_config.clone())),
        translate_config: match partial.translate_config {
            None => None,
            Some(t) => Some(merge_subtitle_translate_fields(t, &global.translate_config)),
        },
    }
}

fn non_empty_or(s: &str, fallback: &str) -> String {
    let t = s.trim();
    if t.is_empty() {
        fallback.to_string()
    } else {
        t.to_string()
    }
}

/// 任务级翻译：`partial` 中空字符串字段回落为 `global` 对应字段。
pub fn merge_subtitle_translate_fields(
    partial: SubtitleTranslateConfig,
    global: &SubtitleTranslateConfig,
) -> SubtitleTranslateConfig {
    SubtitleTranslateConfig {
        base_url: non_empty_or(&partial.base_url, &global.base_url),
        api_key: non_empty_or(&partial.api_key, &global.api_key),
        model: non_empty_or(&partial.model, &global.model),
        target_language: non_empty_or(&partial.target_language, &global.target_language),
        concurrency: if partial.concurrency > 0 {
            partial.concurrency
        } else {
            global.concurrency
        },
        batch_size: if partial.batch_size > 0 {
            partial.batch_size
        } else {
            global.batch_size
        },
        remove_source_srt: partial.remove_source_srt,
    }
}

/// 独立翻译任务：`partial == None` 表示整包使用全局翻译配置。
pub fn merge_subtitle_translate_job_config(
    partial: Option<SubtitleTranslateConfig>,
    global: &SubtitleTranslateConfig,
) -> SubtitleTranslateConfig {
    match partial {
        None => global.clone(),
        Some(t) => merge_subtitle_translate_fields(t, global),
    }
}

/// 设置页保存：翻译 / Stash / Emby 的密钥字段为空时不覆盖已保存密钥。
pub fn merge_app_config_on_put_translate_api_key(
    previous: &AppConfig,
    mut incoming: AppConfig,
) -> AppConfig {
    if incoming.translate_config.api_key.trim().is_empty() {
        incoming.translate_config.api_key = previous.translate_config.api_key.clone();
    }
    if incoming.stash_config.api_key.trim().is_empty() {
        incoming.stash_config.api_key = previous.stash_config.api_key.clone();
    }
    if incoming.emby_config.password.trim().is_empty() {
        incoming.emby_config.password = previous.emby_config.password.clone();
    }
    if incoming.emby_config.api_key.trim().is_empty() {
        incoming.emby_config.api_key = previous.emby_config.api_key.clone();
    }
    incoming
}
