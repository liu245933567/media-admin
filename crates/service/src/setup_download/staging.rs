use anyhow::Result;
use ma_utils::config::get_download_dir;
use std::path::PathBuf;

/// 所有设置页下载的暂存均在此子目录，便于一次性清理未完成内容。
pub fn staging_root() -> PathBuf {
    get_download_dir().join(".media-admin-staging")
}

pub async fn reset_staging_dir() -> Result<()> {
    let root = staging_root();
    if tokio::fs::try_exists(&root).await.unwrap_or(false) {
        tokio::fs::remove_dir_all(&root).await?;
    }
    tokio::fs::create_dir_all(&root).await?;
    Ok(())
}
