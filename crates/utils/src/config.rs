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

/// 获取ffmpeg目录
fn get_ffmpeg_dir() -> PathBuf {
    match std::env::var("FFMPEG_DIR") {
        Ok(path) => PathBuf::from(path),
        Err(_) => get_default_app_path().join("ffmpeg"),
    }
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
        Err(_) => bail!("未设置 TRANSLATE_OPENAI_API_BASE 环境变量"),
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
