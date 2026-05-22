use std::path::{Path, PathBuf};

use anyhow::{Context, Result, anyhow, bail};
use futures_util::StreamExt;
use ma_utils::config::get_ffmpeg_dir;
use serde::Deserialize;
use taskmill::TaskError;
use tokio::io::AsyncWriteExt;

use super::progress::DownloadProgressHandle;
use super::staging::staging_root;

#[derive(Debug, Deserialize)]
struct GhRelease {
    assets: Vec<GhAsset>,
}

#[derive(Debug, Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

fn pick_ffmpeg_asset(assets: &[GhAsset]) -> Result<&GhAsset> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let candidates: Vec<&GhAsset> = assets
        .iter()
        .filter(|a| {
            let n = a.name.to_ascii_lowercase();
            n.contains("gpl") && !n.contains("shared")
        })
        .collect();

    let picked = candidates.iter().copied().find(|a| {
        let n = a.name.to_ascii_lowercase();
        match (os, arch) {
            ("windows", _) => n.contains("win64") && n.ends_with(".zip"),
            ("linux", "x86_64") => {
                n.contains("linux64") && !n.contains("arm") && n.ends_with(".tar.xz")
            }
            ("linux", "aarch64") => n.contains("linuxarm64") && n.ends_with(".tar.xz"),
            ("macos", "aarch64") => n.contains("macosarm64") && n.ends_with(".zip"),
            ("macos", "x86_64") => {
                n.contains("macos64") && !n.contains("macosarm64") && n.ends_with(".zip")
            }
            _ => false,
        }
    });

    picked
        .or_else(|| {
            candidates.iter().copied().find(|a| {
                let n = a.name.to_ascii_lowercase();
                match os {
                    "windows" => n.contains("win64") && n.ends_with(".zip"),
                    "linux" => n.contains("linux64") && n.ends_with(".tar.xz"),
                    "macos" => n.ends_with(".zip") && n.contains("macos"),
                    _ => false,
                }
            })
        })
        .ok_or_else(|| {
            anyhow!("当前平台 {os}/{arch} 未找到匹配的 FFmpeg 构建，请手动安装并设置 FFMPEG_DIR")
        })
}

async fn resolve_ffmpeg_download_url(client: &reqwest::Client) -> Result<(String, String)> {
    let url = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest";
    let res = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "media-admin-setup")
        .send()
        .await
        .context("请求 GitHub releases 失败")?;

    if !res.status().is_success() {
        bail!("GitHub API 失败: HTTP {}", res.status());
    }

    let rel: GhRelease = res.json().await.context("解析 GitHub JSON 失败")?;
    let asset = pick_ffmpeg_asset(&rel.assets)?;
    Ok((asset.browser_download_url.clone(), asset.name.clone()))
}

async fn download_to_file(
    client: &reqwest::Client,
    download_url: &str,
    dest: &Path,
    progress: &DownloadProgressHandle<'_>,
    phase_label: &str,
    mut check_cancelled: impl FnMut() -> Result<(), TaskError>,
) -> Result<u64> {
    progress
        .update("downloading", 0, None, format!("开始下载 {phase_label}"))
        .await;
    check_cancelled()?;

    let res = client
        .get(download_url)
        .header("User-Agent", "media-admin-setup")
        .send()
        .await
        .with_context(|| format!("下载请求失败: {download_url}"))?;

    if !res.status().is_success() {
        bail!("下载失败 HTTP {}: {}", res.status(), download_url);
    }

    let total = res.content_length();
    if dest.exists() {
        tokio::fs::remove_file(dest).await.ok();
    }
    let mut file = tokio::fs::File::create(dest).await?;
    let mut received: u64 = 0;
    let mut stream = res.bytes_stream();

    while let Some(chunk) = stream.next().await {
        check_cancelled()?;
        let chunk = chunk.context("读取 FFmpeg 包流失败")?;
        file.write_all(&chunk).await?;
        received += chunk.len() as u64;
        if received % (4 * 1024 * 1024) < chunk.len() as u64 {
            progress
                .update(
                    "downloading",
                    received,
                    total,
                    format!(
                        "已下载 FFmpeg 包 {} / {}",
                        super::whisper::format_bytes(received),
                        super::whisper::format_total(total)
                    ),
                )
                .await;
        }
    }
    file.flush().await?;
    Ok(received)
}

/// 校验目录树内存在 ffmpeg 可执行文件（BtbN 包通常在 `bin/` 下）。
fn ensure_ffmpeg_binary_present(root: &Path) -> Result<()> {
    fn walk(dir: &Path, found: &mut bool) -> std::io::Result<()> {
        if *found {
            return Ok(());
        }
        for e in std::fs::read_dir(dir)?.flatten() {
            let p = e.path();
            let ft = e.file_type()?;
            if ft.is_dir() {
                walk(&p, found)?;
            } else if ft.is_file() {
                let name = e.file_name().to_string_lossy().to_ascii_lowercase();
                if name == "ffmpeg.exe" || name == "ffmpeg" {
                    *found = true;
                    return Ok(());
                }
            }
        }
        Ok(())
    }

    let mut found = false;
    walk(root, &mut found).map_err(|e| anyhow!("遍历解压目录失败: {e}"))?;
    if found {
        Ok(())
    } else {
        bail!("解压包内未找到 ffmpeg 可执行文件")
    }
}

/// BtbN 压缩包通常只有一层顶层目录（如 `ffmpeg-8.0-full_build/`）。
fn resolve_extract_payload_root(extract_dir: &Path) -> Result<PathBuf> {
    let mut dirs = Vec::new();
    let mut file_count = 0usize;
    for e in std::fs::read_dir(extract_dir).context("读取解压目录失败")? {
        let e = e?;
        let ft = e.file_type()?;
        if ft.is_dir() {
            dirs.push(e.path());
        } else if ft.is_file() {
            file_count += 1;
        }
    }
    if dirs.len() == 1 && file_count == 0 {
        Ok(dirs.pop().unwrap())
    } else {
        Ok(extract_dir.to_path_buf())
    }
}

async fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    tokio::fs::create_dir_all(dst).await?;
    let mut entries = tokio::fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let ft = entry.file_type().await?;
        if ft.is_dir() {
            Box::pin(copy_dir_recursive(&from, &to)).await?;
        } else {
            tokio::fs::copy(&from, &to).await?;
        }
    }
    Ok(())
}

/// 将解压后的完整目录树安装到 `FFMPEG_DIR`（含 bin/ffprobe 等）。
async fn install_extracted_tree(payload_root: &Path, dest_dir: &Path) -> Result<()> {
    ensure_ffmpeg_binary_present(payload_root)?;

    if tokio::fs::try_exists(dest_dir).await.unwrap_or(false) {
        tokio::fs::remove_dir_all(dest_dir).await?;
    }
    if let Some(parent) = dest_dir.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    if tokio::fs::rename(payload_root, dest_dir).await.is_err() {
        copy_dir_recursive(payload_root, dest_dir).await?;
        tokio::fs::remove_dir_all(payload_root).await.ok();
    }

    #[cfg(unix)]
    chmod_bin_executables(dest_dir).await?;

    Ok(())
}

#[cfg(unix)]
async fn chmod_bin_executables(dest_dir: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;

    let bin = dest_dir.join("bin");
    if !bin.is_dir() {
        return Ok(());
    }
    let mode = std::fs::Permissions::from_mode(0o755);
    let mut entries = tokio::fs::read_dir(&bin).await?;
    while let Some(entry) = entries.next_entry().await? {
        if entry.file_type().await?.is_file() {
            tokio::fs::set_permissions(entry.path(), mode.clone())
                .await
                .ok();
        }
    }
    Ok(())
}

fn extract_zip_sync(archive_path: &Path, out_dir: &Path) -> Result<()> {
    use std::fs::File;
    use zip::ZipArchive;

    let f = File::open(archive_path)?;
    let mut zip = ZipArchive::new(f)?;
    std::fs::create_dir_all(out_dir)?;
    for i in 0..zip.len() {
        let mut file = zip.by_index(i)?;
        let outpath = match file.enclosed_name() {
            Some(p) => out_dir.join(p),
            None => continue,
        };
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath)?;
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut outfile = File::create(&outpath)?;
            std::io::copy(&mut file, &mut outfile)?;
        }
    }
    Ok(())
}

#[cfg(not(windows))]
fn extract_tar_xz_sync(archive_path: &Path, out_dir: &Path) -> Result<()> {
    std::fs::create_dir_all(out_dir)?;
    let status = std::process::Command::new("tar")
        .arg("-xf")
        .arg(archive_path.as_os_str())
        .arg("-C")
        .arg(out_dir.as_os_str())
        .status()
        .context("执行 tar 解压失败")?;
    if !status.success() {
        bail!("tar 解压退出码非 0: {status}");
    }
    Ok(())
}

pub async fn run_ffmpeg_download(
    client: &reqwest::Client,
    progress: &DownloadProgressHandle<'_>,
    mut check_cancelled: impl FnMut() -> Result<(), TaskError>,
) -> Result<()> {
    progress
        .update("resolving", 0, None, "正在解析 FFmpeg 下载地址…")
        .await;
    check_cancelled()?;

    let (download_url, asset_name) = resolve_ffmpeg_download_url(client).await?;

    let staging = staging_root().join("ffmpeg");
    tokio::fs::create_dir_all(&staging).await?;

    let ext = if asset_name.to_ascii_lowercase().ends_with(".tar.xz") {
        ".tar.xz"
    } else if asset_name.to_ascii_lowercase().ends_with(".zip") {
        ".zip"
    } else {
        bail!("未知压缩格式: {asset_name}");
    };

    let archive_path = staging.join(format!("ffmpeg-pack{ext}"));
    download_to_file(
        client,
        &download_url,
        &archive_path,
        progress,
        &asset_name,
        &mut check_cancelled,
    )
    .await?;

    progress.update("extracting", 0, None, "正在解压…").await;
    check_cancelled()?;

    let extract_dir = staging.join("unpack");
    if tokio::fs::try_exists(&extract_dir).await.unwrap_or(false) {
        tokio::fs::remove_dir_all(&extract_dir).await?;
    }
    tokio::fs::create_dir_all(&extract_dir).await?;

    let archive_clone = archive_path.clone();
    let extract_clone = extract_dir.clone();
    let is_zip = ext == ".zip";

    tokio::task::spawn_blocking(move || -> Result<()> {
        if is_zip {
            extract_zip_sync(&archive_clone, &extract_clone)
        } else {
            #[cfg(not(windows))]
            {
                extract_tar_xz_sync(&archive_clone, &extract_clone)
            }
            #[cfg(windows)]
            {
                bail!("Windows 上不支持 tar.xz 包")
            }
        }
    })
    .await
    .context("解压任务 panic")?
    .context("解压失败")?;

    check_cancelled()?;

    let payload_root = tokio::task::spawn_blocking({
        let extract_dir = extract_dir.clone();
        move || resolve_extract_payload_root(&extract_dir)
    })
    .await
    .context("解析解压目录 panic")??;

    let dest_dir = get_ffmpeg_dir();

    progress
        .update("moving", 0, None, "正在安装到工具目录…")
        .await;
    check_cancelled()?;

    install_extracted_tree(&payload_root, &dest_dir)
        .await
        .with_context(|| format!("安装 FFmpeg 到 {} 失败", dest_dir.display()))?;

    tokio::fs::remove_file(&archive_path).await.ok();
    if tokio::fs::try_exists(&extract_dir).await.unwrap_or(false) {
        tokio::fs::remove_dir_all(&extract_dir).await.ok();
    }

    progress
        .update("done", 0, None, format!("已安装到 {}", dest_dir.display()))
        .await;

    Ok(())
}
