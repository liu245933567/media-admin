use std::path::PathBuf;

use anyhow::{Context, Result, anyhow, bail};
use futures_util::StreamExt;
use ma_utils::config::{get_download_dir, get_models_dir};
use taskmill::TaskError;
use tokio::io::AsyncWriteExt;

use super::catalog::{self, whisper_catalog};
use super::progress::DownloadProgressHandle;
use super::staging::staging_root;

pub async fn run_whisper_download(
    client: &reqwest::Client,
    model_id: String,
    progress: &DownloadProgressHandle<'_>,
    mut check_cancelled: impl FnMut() -> Result<(), TaskError>,
) -> Result<()> {
    let item = whisper_catalog()
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| anyhow!("未知模型 id: {model_id}"))?;

    progress
        .update(
            "downloading",
            0,
            None,
            format!("开始下载 {}", item.filename),
        )
        .await;
    check_cancelled()?;

    let url = catalog::whisper_download_url(&item.filename);
    let res = client
        .get(&url)
        .send()
        .await
        .with_context(|| format!("请求模型失败: {url}"))?;

    if !res.status().is_success() {
        bail!("下载失败 HTTP {}: {}", res.status(), url);
    }

    let total = res.content_length();
    let staging_whisper = staging_root().join("whisper");
    tokio::fs::create_dir_all(&staging_whisper).await?;
    let part_path: PathBuf = staging_whisper.join(format!("{}.part", item.filename));

    if tokio::fs::try_exists(&part_path).await.unwrap_or(false) {
        tokio::fs::remove_file(&part_path).await.ok();
    }

    let mut file = tokio::fs::File::create(&part_path)
        .await
        .with_context(|| format!("创建临时文件失败: {}", part_path.display()))?;

    let mut received: u64 = 0;
    let mut stream = res.bytes_stream();

    while let Some(chunk) = stream.next().await {
        check_cancelled()?;
        let chunk = chunk.with_context(|| "读取下载流失败")?;
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        if received % (2 * 1024 * 1024) < chunk.len() as u64 || total == Some(received) {
            progress
                .update(
                    "downloading",
                    received,
                    total,
                    format!(
                        "已下载 {} / {}",
                        format_bytes(received),
                        format_total(total)
                    ),
                )
                .await;
        }
    }

    file.flush().await?;
    drop(file);

    check_cancelled()?;
    progress
        .update("moving", received, total, "正在写入模型目录")
        .await;

    let models_dir = get_models_dir();
    tokio::fs::create_dir_all(&models_dir).await?;
    let dest = models_dir.join(&item.filename);

    if tokio::fs::try_exists(&dest).await.unwrap_or(false) {
        tokio::fs::remove_file(&dest).await.ok();
    }

    if let Err(e) = tokio::fs::rename(&part_path, &dest).await {
        tracing::warn!(?e, "rename 失败，尝试复制");
        tokio::fs::copy(&part_path, &dest)
            .await
            .with_context(|| format!("复制到 {} 失败", dest.display()))?;
        tokio::fs::remove_file(&part_path).await.ok();
    }

    progress
        .update(
            "done",
            received,
            total,
            format!("已保存到 {}", dest.display()),
        )
        .await;

    Ok(())
}

pub(super) fn format_bytes(n: u64) -> String {
    const KB: u64 = 1024;
    const MB: u64 = KB * 1024;
    const GB: u64 = MB * 1024;
    if n >= GB {
        format!("{:.2} GiB", n as f64 / GB as f64)
    } else if n >= MB {
        format!("{:.2} MiB", n as f64 / MB as f64)
    } else if n >= KB {
        format!("{:.2} KiB", n as f64 / KB as f64)
    } else {
        format!("{n} B")
    }
}

pub(super) fn format_total(total: Option<u64>) -> String {
    total.map(format_bytes).unwrap_or_else(|| "未知".into())
}

/// 若模型已在 models 目录存在，供 UI 展示。
#[allow(dead_code)]
pub async fn model_file_exists(filename: &str) -> bool {
    let p = get_models_dir().join(filename);
    tokio::fs::try_exists(p).await.unwrap_or(false)
}

/// 确保 download 根目录存在（staging 的父级）。
pub async fn ensure_download_parent() -> Result<()> {
    tokio::fs::create_dir_all(get_download_dir()).await?;
    Ok(())
}
