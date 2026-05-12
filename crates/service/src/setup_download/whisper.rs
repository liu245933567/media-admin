use std::path::PathBuf;

use anyhow::{Context, Result, anyhow, bail};
use futures_util::StreamExt;
use ma_utils::config::{get_models_dir, get_download_dir};
use tokio::io::AsyncWriteExt;
use tokio::sync::watch;

use super::catalog::{self, whisper_catalog};
use super::staging::staging_root;
use super::types::DownloadProgressSnapshot;

async fn send_progress(
    tx: &watch::Sender<DownloadProgressSnapshot>,
    phase: &str,
    received: u64,
    total: Option<u64>,
    message: impl Into<String>,
) {
    let _ = tx.send(DownloadProgressSnapshot {
        phase: phase.into(),
        bytes_received: received as f64,
        bytes_total: total.map(|t| t as f64),
        message: message.into(),
    });
}

pub async fn run_whisper_download(
    client: &reqwest::Client,
    model_id: String,
    progress: watch::Sender<DownloadProgressSnapshot>,
) -> Result<()> {
    let item = whisper_catalog()
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| anyhow!("未知模型 id: {model_id}"))?;

    send_progress(
        &progress,
        "downloading",
        0,
        None,
        format!("开始下载 {}", item.filename),
    )
    .await;

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
        let chunk = chunk.with_context(|| "读取下载流失败")?;
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        if received % (2 * 1024 * 1024) < chunk.len() as u64 || total == Some(received) {
            send_progress(
                &progress,
                "downloading",
                received,
                total,
                format!("已下载 {} / {}", format_bytes(received), format_total(total)),
            )
            .await;
        }
    }

    file.flush().await?;
    drop(file);

    send_progress(
        &progress,
        "moving",
        received,
        total,
        "正在写入模型目录",
    )
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

    let _ = progress.send(DownloadProgressSnapshot {
        phase: "done".into(),
        bytes_received: received as f64,
        bytes_total: total.map(|t| t as f64),
        message: format!("已保存到 {}", dest.display()),
    });

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

pub fn spawn_whisper_job(
    client: reqwest::Client,
    model_id: String,
    progress: watch::Sender<DownloadProgressSnapshot>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        if let Err(e) = run_whisper_download(&client, model_id, progress.clone()).await {
            let _ = progress.send(DownloadProgressSnapshot {
                phase: "error".into(),
                bytes_received: 0.0,
                bytes_total: None,
                message: e.to_string(),
            });
        }
    })
}

/// 若模型已在 models 目录存在，供 UI 展示（可选，计划未强制 — 跳过或简单实现）
#[allow(dead_code)]
pub async fn model_file_exists(filename: &str) -> bool {
    let p = get_models_dir().join(filename);
    tokio::fs::try_exists(p).await.unwrap_or(false)
}

/// 确保 download 根目录存在（staging 的父级）
pub async fn ensure_download_parent() -> Result<()> {
    tokio::fs::create_dir_all(get_download_dir()).await?;
    Ok(())
}
