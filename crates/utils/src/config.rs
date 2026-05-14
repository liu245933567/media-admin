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
    let dir = get_ffmpeg_dir();
    dir.join("ffmpeg.exe").is_file() || dir.join("ffmpeg").is_file()
}

/// 获取 ffmpeg 可执行文件路径
pub fn get_ffmpeg_bin_path() -> Result<String> {
    let dir = get_ffmpeg_dir();
    let win = dir.join("ffmpeg.exe");
    if win.exists() {
        return Ok(win.to_string_lossy().to_string());
    }
    let unix = dir.join("ffmpeg");
    if unix.exists() {
        return Ok(unix.to_string_lossy().to_string());
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

pub fn get_stash_base_url() -> Result<String> {
    match std::env::var("STASH_BASE_URL") {
        Ok(url) => Ok(url.trim().to_string()),
        Err(_) => bail!("未设置 STASH_BASE_URL 环境变量"),
    }
}

pub fn get_stash_api_key() -> Result<String> {
    match std::env::var("STASH_API_KEY") {
        Ok(key) => Ok(key.trim().to_string()),
        Err(_) => bail!("未设置 STASH_API_KEY 环境变量"),
    }
}

pub fn get_app_data_dir() -> Result<PathBuf> {
    match std::env::var("APP_DATA_DIR") {
        Ok(path) => Ok(PathBuf::from(path.trim().to_string())),
        Err(_) => Ok(get_default_app_path().join("data")),
    }
}

/// 供 sqlx 使用的 SQLite 连接 URL。
///
/// 由 `SQLITE_DB_FILE` 或 `get_app_data_dir()/media_admin.db` 解析路径，相对路径按 `cwd` 转为绝对路径；
/// Windows 盘符与 Unix 根路径按 sqlx 0.8 的 URL 规则分别处理；附带 `mode=rwc` 以便库文件不存在时可创建。
pub fn get_sqlite_connect_url() -> Result<String> {
    let path = match std::env::var("SQLITE_DB_FILE") {
        Ok(file) => PathBuf::from(file.trim()),
        Err(_) => get_app_data_dir()?.join("media_admin.db"),
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
