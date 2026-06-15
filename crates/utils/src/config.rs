use std::path::PathBuf;

use anyhow::{Result, bail};

/// 获取默认应用目录
fn get_default_app_path() -> PathBuf {
    std::env::home_dir().unwrap().join(".media-admin")
}

/// 获取模型目录
pub fn get_models_dir() -> PathBuf {
    match std::env::var("MODELS_DIR") {
        Ok(path) => PathBuf::from(path),
        Err(_) => get_default_app_path().join("models"),
    }
}

/// 获取下载目录
pub fn get_download_dir() -> PathBuf {
    match std::env::var("DOWNLOAD_DIR") {
        Ok(path) => PathBuf::from(path),
        Err(_) => get_default_app_path().join("download"),
    }
}

/// 获取 ffmpeg 安装目录（可写入 `ffmpeg` / `ffmpeg.exe`）
pub fn get_ffmpeg_dir() -> PathBuf {
    match std::env::var("FFMPEG_DIR") {
        Ok(path) => PathBuf::from(path),
        Err(_) => get_default_app_path().join("tools/ffmpeg"),
    }
}

/// 配置的 FFMPEG_DIR 下是否已存在 ffmpeg / ffmpeg.exe（不校验是否可执行）
pub fn ffmpeg_tool_installed() -> bool {
    get_ffmpeg_bin_path().is_ok()
}

/// 获取 ffmpeg 可执行文件路径
pub fn get_ffmpeg_bin_path() -> Result<String> {
    let dir = get_ffmpeg_dir();
    let candidates = if cfg!(windows) {
        [dir.join("bin/ffmpeg.exe"), dir.join("ffmpeg.exe")]
    } else {
        [dir.join("bin/ffmpeg"), dir.join("ffmpeg")]
    };
    for p in candidates {
        if p.is_file() {
            return Ok(p.to_string_lossy().to_string());
        }
    }
    bail!("未找到 ffmpeg 可执行文件");
}

/// 获取临时 WAV 目录
pub fn get_temp_wav_dir() -> PathBuf {
    match std::env::var("TEMP_WAV_DIR") {
        Ok(path) => PathBuf::from(path),
        Err(_) => get_default_app_path().join("temp/wav"),
    }
}

/// 视频浏览器转码缓存目录（H.264 + AAC 的 MP4）
pub fn get_transcode_cache_dir() -> PathBuf {
    match std::env::var("TRANSCODE_CACHE_DIR") {
        Ok(path) => PathBuf::from(path),
        Err(_) => get_default_app_path().join("temp/transcode"),
    }
}

/// 获取 字幕 缓存目录
pub fn get_subtitle_cache_dir() -> PathBuf {
    match std::env::var("SUBTITLE_CACHE_DIR") {
        Ok(path) => PathBuf::from(path),
        Err(_) => get_default_app_path().join("temp/subtitle"),
    }
}

/// 转码时 GPU（NVENC）使用策略，由环境变量 `TRANSCODE_GPU` 控制。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TranscodeGpuMode {
    /// 检测到 `h264_nvenc` 时优先 GPU，失败则回退 CPU
    Auto,
    /// 强制尝试 NVENC（失败则回退 CPU）
    Nvenc,
    /// 仅 CPU（libx264）
    Off,
}

/// 读取 `TRANSCODE_GPU`：`auto`（默认）/ `nvenc` / `off`（亦支持 `1`/`0`/`cpu`）。
pub fn get_transcode_gpu_mode() -> TranscodeGpuMode {
    match std::env::var("TRANSCODE_GPU")
        .map(|s| s.trim().to_ascii_lowercase())
        .as_deref()
    {
        Ok("nvenc") | Ok("on") | Ok("gpu") | Ok("1") | Ok("true") => TranscodeGpuMode::Nvenc,
        Ok("off") | Ok("cpu") | Ok("0") | Ok("false") => TranscodeGpuMode::Off,
        _ => TranscodeGpuMode::Auto,
    }
}

/// 获取翻译 OpenAI API 基地址
pub fn get_translate_openai_base() -> Result<String> {
    match std::env::var("TRANSLATE_OPENAI_BASE") {
        Ok(base) => Ok(base.trim().to_string()),
        Err(_) => bail!("未设置 TRANSLATE_OPENAI_BASE 环境变量"),
    }
}

/// 获取翻译 OpenAI API 密钥
pub fn get_translate_openai_api_key() -> Result<String> {
    match std::env::var("TRANSLATE_OPENAI_API_KEY") {
        Ok(key) => Ok(key.trim().to_string()),
        Err(_) => bail!("未设置 TRANSLATE_OPENAI_API_KEY 环境变量"),
    }
}

/// 获取翻译 OpenAI 默认模型
pub fn get_translate_openai_default_model() -> Result<String> {
    match std::env::var("TRANSLATE_OPENAI_DEFAULT_MODEL") {
        Ok(model) => Ok(model.trim().to_string()),
        Err(_) => bail!("未设置 TRANSLATE_OPENAI_DEFAULT_MODEL 环境变量"),
    }
}

pub fn get_app_data_dir() -> Result<PathBuf> {
    match std::env::var("APP_DATA_DIR") {
        Ok(path) => Ok(PathBuf::from(path.trim().to_string())),
        Err(_) => Ok(get_default_app_path().join("data")),
    }
}

/// 全局 [`AppConfig`] 本地 JSON 路径（`APP_CONFIG_FILE` 或 `get_app_data_dir()/app_config.json`）。
pub fn get_app_config_file_path() -> Result<PathBuf> {
    match std::env::var("APP_CONFIG_FILE") {
        Ok(path) => Ok(PathBuf::from(path.trim())),
        Err(_) => Ok(get_app_data_dir()?.join("app_config.json")),
    }
}

/// 供 sqlx 使用的 SQLite 连接 URL。
///
/// 由 `SQLITE_DB_FILE` 或 `get_app_data_dir()/media_admin.db` 解析路径，相对路径按 `cwd` 转为绝对路径；
/// Windows 盘符与 Unix 根路径按 sqlx 0.8 的 URL 规则分别处理；附带 `mode=rwc` 以便库文件不存在时可创建。
pub fn get_sqlite_connect_url() -> Result<String> {
    let path = match std::env::var("SQLITE_DB_FILE") {
        Ok(file) => PathBuf::from(file.trim()),
        Err(_) => get_app_data_dir()?.join("media_admin.sqlite"),
    };
    let absolute = if path.is_absolute() {
        path
    } else {
        std::env::current_dir()?.join(path)
    };
    let normalized = absolute.to_string_lossy().replace('\\', "/");

    if cfg!(windows) {
        let is_drive_letter = normalized
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphabetic)
            && normalized.as_bytes().get(1) == Some(&b':')
            && normalized.as_bytes().get(2) == Some(&b'/');

        if is_drive_letter || normalized.starts_with("//") {
            return Ok(format!("sqlite://{}?mode=rwc", normalized));
        }
    }

    let path_in_url = if normalized.starts_with("//") {
        normalized
    } else if let Some(rest) = normalized.strip_prefix('/') {
        rest.to_string()
    } else {
        normalized
    };

    Ok(format!("sqlite:///{}?mode=rwc", path_in_url))
}

pub fn get_sqlx_logging() -> bool {
    match std::env::var("SQLX_LOGGING") {
        Ok(v) => {
            let s = v.trim().to_ascii_lowercase();
            matches!(s.as_str(), "1" | "true" | "yes" | "on")
        }
        Err(_) => cfg!(debug_assertions),
    }
}
