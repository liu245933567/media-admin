//! 从本地 JSON 文件加载 / 持久化 [`AppConfig`]。

use std::path::Path;

use anyhow::{Context, Result};
use ma_service::AppConfig;
use ma_utils::config::get_app_config_file_path;
use tokio::fs;

/// 读取 JSON；文件不存在时写入 [`AppConfig::from_generate_defaults`] 并返回。
pub async fn load_or_init_app_config() -> Result<AppConfig> {
    let path = get_app_config_file_path()?;
    ensure_parent_dir(&path).await?;

    if path.is_file() {
        return read_app_config_file(&path).await;
    }

    let config = AppConfig::from_generate_defaults();
    persist_app_config(&config)
        .await
        .context("写入默认 app_config")?;
    Ok(config)
}

/// 将当前配置写入本地 JSON 文件。
pub async fn persist_app_config(config: &AppConfig) -> Result<()> {
    let path = get_app_config_file_path()?;
    ensure_parent_dir(&path).await?;

    let json = serde_json::to_string_pretty(config).context("序列化 AppConfig")?;
    fs::write(&path, json)
        .await
        .with_context(|| format!("写入 {}", path.display()))?;
    Ok(())
}

async fn ensure_parent_dir(path: &Path) -> Result<()> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)
                .await
                .with_context(|| format!("创建目录 {}", parent.display()))?;
        }
    }
    Ok(())
}

async fn read_app_config_file(path: &Path) -> Result<AppConfig> {
    let json = fs::read_to_string(path)
        .await
        .with_context(|| format!("读取 {}", path.display()))?;
    serde_json::from_str(&json).with_context(|| format!("解析 {} 失败", path.display()))
}
