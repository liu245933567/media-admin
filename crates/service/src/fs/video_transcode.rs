//! 本地视频转码为 H.264 + AAC MP4，带磁盘缓存与进度查询。

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::UNIX_EPOCH,
};

use anyhow::{Context, Result, bail};
use ma_utils::config::{
    TranscodeGpuMode, get_ffmpeg_bin_path, get_transcode_cache_dir, get_transcode_gpu_mode,
};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use tokio::sync::Mutex;
use typeshare::typeshare;

use crate::media_paths::validate_video_path;

#[cfg(windows)]
use std::os::windows::process::CommandExt as _;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VideoTranscodePhase {
    Idle,
    Running,
    Ready,
    Failed,
}

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoTranscodeStatusRes {
    pub phase: VideoTranscodePhase,
    /// 0.0–1.0，仅 `running` 时有效
    pub progress: Option<f32>,
    pub message: Option<String>,
}

struct TranscodeRuntime {
    phase: VideoTranscodePhase,
    progress: f32,
    message: String,
}

struct Registry {
    by_key: HashMap<String, Arc<Mutex<TranscodeRuntime>>>,
}

static REGISTRY: std::sync::OnceLock<Mutex<Registry>> = std::sync::OnceLock::new();

/// 进程内缓存：当前 ffmpeg 是否列出 `h264_nvenc`。
static NVENC_AVAILABLE: std::sync::OnceLock<bool> = std::sync::OnceLock::new();

/// 转码视频编码后端（流复制 / NVENC / x264）。
enum TranscodeVideoBackend {
    RemuxCopy,
    NvencCuda,
    Libx264,
}

fn registry() -> &'static Mutex<Registry> {
    REGISTRY.get_or_init(|| {
        Mutex::new(Registry {
            by_key: HashMap::new(),
        })
    })
}

/// 查询转码状态；若缓存已就绪则直接返回 `ready`。
pub async fn video_transcode_status(source_path: String) -> Result<VideoTranscodeStatusRes> {
    let (source, key, cache_path) = resolve_source_and_cache(&source_path).await?;
    if cache_path.is_file() {
        if cache_is_valid(&cache_path).await? {
            return Ok(status_ready());
        }
        let _ = tokio::fs::remove_file(&cache_path).await;
    }

    let reg = registry().lock().await;
    if let Some(rt) = reg.by_key.get(&key) {
        let inner = rt.lock().await;
        return Ok(runtime_to_status(&inner));
    }
    drop(reg);

    let _ = source;
    Ok(VideoTranscodeStatusRes {
        phase: VideoTranscodePhase::Idle,
        progress: None,
        message: Some("尚未开始转码".into()),
    })
}

/// 启动转码（若已在进行或已完成则幂等返回当前状态）。
pub async fn start_video_transcode(source_path: String) -> Result<VideoTranscodeStatusRes> {
    let (source, key, cache_path) = resolve_source_and_cache(&source_path).await?;

    if cache_path.is_file() && cache_is_valid(&cache_path).await? {
        return Ok(status_ready());
    }

    let entry = {
        let mut reg = registry().lock().await;
        if let Some(existing) = reg.by_key.get(&key) {
            existing.clone()
        } else {
            let rt = Arc::new(Mutex::new(TranscodeRuntime {
                phase: VideoTranscodePhase::Idle,
                progress: 0.0,
                message: "排队中…".into(),
            }));
            reg.by_key.insert(key.clone(), rt.clone());
            rt
        }
    };

    {
        let inner = entry.lock().await;
        if inner.phase == VideoTranscodePhase::Running {
            return Ok(runtime_to_status(&inner));
        }
        if inner.phase == VideoTranscodePhase::Ready {
            return Ok(runtime_to_status(&inner));
        }
    }

    if cache_path.exists() {
        let _ = tokio::fs::remove_file(&cache_path).await;
    }
    if let Some(parent) = cache_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let tmp_path = cache_path.with_extension("mp4.part");
    if tmp_path.exists() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
    }

    {
        let mut inner = entry.lock().await;
        inner.phase = VideoTranscodePhase::Running;
        inner.progress = 0.0;
        inner.message = "正在转码…".into();
    }

    let entry_spawn = entry.clone();
    let source_spawn = source.clone();
    let cache_spawn = cache_path.clone();
    let tmp_spawn = tmp_path.clone();

    tokio::spawn(async move {
        let result = run_ffmpeg_transcode(&source_spawn, &tmp_spawn, entry_spawn.clone()).await;
        let mut inner = entry_spawn.lock().await;
        match result {
            Ok(()) => {
                if let Err(e) = tokio::fs::rename(&tmp_spawn, &cache_spawn).await {
                    inner.phase = VideoTranscodePhase::Failed;
                    inner.message = format!("移动转码文件失败: {e:#}");
                } else {
                    inner.phase = VideoTranscodePhase::Ready;
                    inner.progress = 1.0;
                    inner.message = "转码完成".into();
                }
            }
            Err(e) => {
                inner.phase = VideoTranscodePhase::Failed;
                inner.progress = 0.0;
                inner.message = format!("{e:#}");
                let _ = tokio::fs::remove_file(&tmp_spawn).await;
            }
        }
    });

    let inner = entry.lock().await;
    Ok(runtime_to_status(&inner))
}

/// 解析源视频对应的转码缓存 MP4 路径（须已 `ready`）。
pub async fn resolve_transcoded_video_path(source_path: String) -> Result<PathBuf> {
    let (_, _key, cache_path) = resolve_source_and_cache(&source_path).await?;
    if !cache_path.is_file() {
        bail!("转码文件尚未就绪");
    }
    if !cache_is_valid(&cache_path).await? {
        bail!("转码缓存无效，请重新转码");
    }
    Ok(cache_path)
}

async fn resolve_source_and_cache(source_path: &str) -> Result<(PathBuf, String, PathBuf)> {
    let source = PathBuf::from(source_path.trim());
    validate_video_path(&source).await?;
    let meta = tokio::fs::metadata(&source).await?;
    let key = cache_key(&source, &meta);
    let cache_path = get_transcode_cache_dir().join(format!("{key}.mp4"));
    Ok((source, key, cache_path))
}

fn cache_key(source: &Path, meta: &std::fs::Metadata) -> String {
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let payload = format!(
        "{}:{}:{}",
        source.to_string_lossy(),
        meta.len(),
        mtime
    );
    hex::encode(Sha1::digest(payload.as_bytes()))
}

async fn cache_is_valid(path: &Path) -> Result<bool> {
    let meta = tokio::fs::metadata(path).await?;
    Ok(meta.is_file() && meta.len() > 1024)
}

fn status_ready() -> VideoTranscodeStatusRes {
    VideoTranscodeStatusRes {
        phase: VideoTranscodePhase::Ready,
        progress: Some(1.0),
        message: Some("转码完成".into()),
    }
}

fn runtime_to_status(rt: &TranscodeRuntime) -> VideoTranscodeStatusRes {
    VideoTranscodeStatusRes {
        phase: rt.phase,
        progress: if rt.phase == VideoTranscodePhase::Running {
            Some(rt.progress.clamp(0.0, 0.99))
        } else if rt.phase == VideoTranscodePhase::Ready {
            Some(1.0)
        } else {
            None
        },
        message: Some(rt.message.clone()),
    }
}

/// 是否应尝试 NVIDIA NVENC（受 `TRANSCODE_GPU` 与 ffmpeg 编译能力约束）。
fn should_try_nvenc(ffmpeg: &str) -> bool {
    match get_transcode_gpu_mode() {
        TranscodeGpuMode::Off => false,
        TranscodeGpuMode::Nvenc | TranscodeGpuMode::Auto => ffmpeg_nvenc_available(ffmpeg),
    }
}

fn ffmpeg_nvenc_available(ffmpeg: &str) -> bool {
    *NVENC_AVAILABLE.get_or_init(|| {
        std::thread::scope(|s| {
            s.spawn(|| {
                let mut cmd = std::process::Command::new(ffmpeg);
                #[cfg(windows)]
                cmd.creation_flags(CREATE_NO_WINDOW);
                cmd.args(["-hide_banner", "-encoders"]);
                match cmd.output() {
                    Ok(out) if out.status.success() => {
                        let text = String::from_utf8_lossy(&out.stdout);
                        text.contains("h264_nvenc")
                    }
                    _ => false,
                }
            })
            .join()
            .unwrap_or(false)
        })
    })
}

fn build_transcode_args(input: &Path, output_tmp: &Path, backend: TranscodeVideoBackend) -> Vec<String> {
    let input_s = input.to_string_lossy().into_owned();
    let output_s = output_tmp.to_string_lossy().into_owned();
    let mut args = vec!["-y".to_string()];

    match backend {
        TranscodeVideoBackend::RemuxCopy => {
            args.extend(["-i".into(), input_s]);
            args.extend([
                "-map".into(),
                "0:v:0".into(),
                "-map".into(),
                "0:a:0?".into(),
                "-c".into(),
                "copy".into(),
                "-movflags".into(),
                "+faststart".into(),
            ]);
        }
        TranscodeVideoBackend::NvencCuda => {
            // Windows + NVIDIA：CUDA 硬解 + NVENC 编码（适合 HEVC 等）
            args.extend([
                "-hwaccel".into(),
                "cuda".into(),
                "-i".into(),
                input_s,
                "-map".into(),
                "0:v:0".into(),
                "-map".into(),
                "0:a:0?".into(),
                "-c:v".into(),
                "h264_nvenc".into(),
                "-preset".into(),
                "p4".into(),
                "-rc".into(),
                "vbr".into(),
                "-cq".into(),
                "23".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "128k".into(),
                "-movflags".into(),
                "+faststart".into(),
            ]);
        }
        TranscodeVideoBackend::Libx264 => {
            args.extend(["-i".into(), input_s]);
            args.extend([
                "-map".into(),
                "0:v:0".into(),
                "-map".into(),
                "0:a:0?".into(),
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "veryfast".into(),
                "-crf".into(),
                "22".into(),
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                "128k".into(),
                "-movflags".into(),
                "+faststart".into(),
            ]);
        }
    }

    args.extend([
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        output_s,
    ]);
    args
}

fn transcode_progress_label(backend: TranscodeVideoBackend) -> &'static str {
    match backend {
        TranscodeVideoBackend::NvencCuda => "正在转码（NVIDIA GPU）",
        _ => "正在转码",
    }
}

async fn run_ffmpeg_transcode(
    input: &Path,
    output_tmp: &Path,
    runtime: Arc<Mutex<TranscodeRuntime>>,
) -> Result<()> {
    let ffmpeg = get_ffmpeg_bin_path()?;
    let duration_secs = ffprobe_duration(input).await.unwrap_or(0.0);

    let copy_mode = probe_can_remux(input).await.unwrap_or(false);
    if copy_mode {
        let args = build_transcode_args(input, output_tmp, TranscodeVideoBackend::RemuxCopy);
        return run_ffmpeg_with_args(&ffmpeg, &args, duration_secs, runtime, TranscodeVideoBackend::RemuxCopy).await;
    }

    if should_try_nvenc(&ffmpeg) {
        {
            let mut inner = runtime.lock().await;
            inner.message = "正在使用 NVIDIA GPU 转码…".into();
        }
        let args = build_transcode_args(input, output_tmp, TranscodeVideoBackend::NvencCuda);
        match run_ffmpeg_with_args(&ffmpeg, &args, duration_secs, runtime.clone(), TranscodeVideoBackend::NvencCuda).await
        {
            Ok(()) => return Ok(()),
            Err(gpu_err) => {
                tracing::warn!("NVENC 转码失败，回退 libx264: {gpu_err:#}");
                let _ = tokio::fs::remove_file(output_tmp).await;
                let mut inner = runtime.lock().await;
                inner.progress = 0.0;
                inner.message = "GPU 转码失败，正在使用 CPU 转码…".into();
            }
        }
    }

    let args = build_transcode_args(input, output_tmp, TranscodeVideoBackend::Libx264);
    run_ffmpeg_with_args(&ffmpeg, &args, duration_secs, runtime, TranscodeVideoBackend::Libx264).await
}

async fn run_ffmpeg_with_args(
    ffmpeg: &str,
    args: &[String],
    duration_secs: f64,
    runtime: Arc<Mutex<TranscodeRuntime>>,
    backend: TranscodeVideoBackend,
) -> Result<()> {
    let label = transcode_progress_label(backend);

    let mut cmd = tokio::process::Command::new(ffmpeg);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.args(args);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().context("启动 ffmpeg 转码失败")?;
    let stdout = child
        .stdout
        .take()
        .context("ffmpeg stdout 不可用")?;

    let rt_progress = runtime.clone();
    let progress_task = tokio::spawn(async move {
        use tokio::io::{AsyncBufReadExt, BufReader};
        let mut reader = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            if let Some(ms) = parse_out_time_ms(&line) {
                if duration_secs > 0.0 {
                    let p = (ms / 1_000_000.0 / duration_secs) as f32;
                    let mut inner = rt_progress.lock().await;
                    inner.progress = p.clamp(0.0, 0.99);
                    inner.message = format!("{label}… {:.0}%", inner.progress * 100.0);
                }
            }
        }
    });

    let status = child.wait().await.context("等待 ffmpeg 结束失败")?;
    let _ = progress_task.await;

    if !status.success() {
        let mut err_text = String::new();
        if let Some(mut s) = child.stderr.take() {
            let _ = tokio::io::AsyncReadExt::read_to_string(&mut s, &mut err_text).await;
        }
        bail!(
            "ffmpeg 转码失败 (code={:?}): {}",
            status.code(),
            err_text.chars().take(800).collect::<String>()
        );
    }

    Ok(())
}

fn parse_out_time_ms(line: &str) -> Option<f64> {
    let line = line.trim();
    if let Some(rest) = line.strip_prefix("out_time_ms=") {
        return rest.parse().ok();
    }
    if let Some(rest) = line.strip_prefix("out_time=") {
        let parts: Vec<&str> = rest.split(':').collect();
        if parts.len() == 3 {
            let h: f64 = parts[0].parse().ok()?;
            let m: f64 = parts[1].parse().ok()?;
            let s: f64 = parts[2].parse().ok()?;
            return Some((h * 3600.0 + m * 60.0 + s) * 1_000_000.0);
        }
    }
    None
}

async fn ffprobe_duration(input: &Path) -> Result<f64> {
    let ffmpeg = get_ffmpeg_bin_path()?;
    let ffprobe = ffmpeg.replace("ffmpeg.exe", "ffprobe.exe").replace("ffmpeg", "ffprobe");
    let mut cmd = tokio::process::Command::new(&ffprobe);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(input)
        .output()
        .await?;
    if !output.status.success() {
        bail!("ffprobe duration 失败");
    }
    let s = String::from_utf8_lossy(&output.stdout);
    s.trim().parse::<f64>().context("解析时长失败")
}

/// H.264 + AAC 在 MP4 容器内时可尝试流复制以加速。
async fn probe_can_remux(input: &Path) -> Result<bool> {
    let res = super::video_probe::probe_video_playback(input.to_string_lossy().into_owned()).await?;
    let mp4_like = input.extension().and_then(|e| e.to_str()).is_some_and(|e| {
        matches!(e.to_ascii_lowercase().as_str(), "mp4" | "m4v" | "mov")
    });
    Ok(res.direct_playable && mp4_like)
}
