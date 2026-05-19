//! 设置页静态查询（模型列表 / FFmpeg 就绪状态）。

use ma_utils::config::{ffmpeg_tool_installed, get_models_dir};

use super::catalog::whisper_catalog;
use super::types::{FfmpegSetupStatusRes, WhisperModelItem, WhisperModelsListRes};

/// 可下载 Whisper 模型目录（含本地就绪状态）。
pub fn list_whisper_models() -> WhisperModelsListRes {
    let models_dir = get_models_dir();
    let items = whisper_catalog()
        .into_iter()
        .map(|m| {
            let local_ready = models_dir.join(&m.filename).is_file();
            WhisperModelItem {
                id: m.id,
                label: m.label,
                filename: m.filename,
                description: m.description,
                size_hint: m.size_hint,
                local_ready,
            }
        })
        .collect();
    WhisperModelsListRes { items }
}

/// FFmpeg 工具目录是否已安装可执行文件。
pub fn ffmpeg_setup_status() -> FfmpegSetupStatusRes {
    FfmpegSetupStatusRes {
        local_ready: ffmpeg_tool_installed(),
    }
}
