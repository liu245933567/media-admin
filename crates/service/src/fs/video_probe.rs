//! 使用 ffprobe 判断视频是否适合浏览器直接播放。

use std::path::Path;

use anyhow::{Context, Result, bail};
use ma_utils::config::get_ffmpeg_bin_path;
use serde::{Deserialize, Serialize};
use typeshare::typeshare;

#[cfg(windows)]
use std::os::windows::process::CommandExt as _;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct VideoPlaybackProbeRes {
    /// 是否建议走直链（H.264/AAC 等浏览器常见组合）
    pub direct_playable: bool,
    /// 是否建议服务端转码后再播
    pub needs_transcode: bool,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub container: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    format_name: Option<String>,
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeOut {
    format: Option<FfprobeFormat>,
    streams: Option<Vec<FfprobeStream>>,
}

/// 对本地视频做 ffprobe，并给出播放策略建议。
pub async fn probe_video_playback(path: String) -> Result<VideoPlaybackProbeRes> {
    let p = Path::new(path.trim());
    crate::media_paths::validate_video_path(p).await?;

    let ffprobe = ffprobe_bin_path()?;
    let out = run_ffprobe_json(&ffprobe, p).await?;
    Ok(evaluate_probe(&out))
}

fn ffprobe_bin_path() -> Result<String> {
    let ffmpeg = get_ffmpeg_bin_path()?;
    let probe = if ffmpeg.ends_with("ffmpeg.exe") {
        ffmpeg.replace("ffmpeg.exe", "ffprobe.exe")
    } else if ffmpeg.ends_with("ffmpeg") {
        ffmpeg.replace("ffmpeg", "ffprobe")
    } else {
        bail!("无法由 ffmpeg 路径推导 ffprobe");
    };
    if !Path::new(&probe).exists() {
        bail!("未找到 ffprobe，请确认 FFmpeg 安装完整（需包含 ffprobe）");
    }
    Ok(probe)
}

async fn run_ffprobe_json(ffprobe: &str, input: &Path) -> Result<FfprobeOut> {
    let mut cmd = tokio::process::Command::new(ffprobe);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let output = cmd
        .args([
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-of",
            "json",
        ])
        .arg(input)
        .output()
        .await
        .with_context(|| format!("运行 ffprobe 失败: {ffprobe}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!("ffprobe 退出异常: {stderr}");
    }

    let parsed: FfprobeOut =
        serde_json::from_slice(&output.stdout).context("解析 ffprobe JSON 失败")?;
    Ok(parsed)
}

fn evaluate_probe(probe: &FfprobeOut) -> VideoPlaybackProbeRes {
    let mut video_codec = None;
    let mut audio_codec = None;

    if let Some(streams) = &probe.streams {
        for s in streams {
            match s.codec_type.as_deref() {
                Some("video") if video_codec.is_none() => {
                    video_codec = s.codec_name.clone();
                }
                Some("audio") if audio_codec.is_none() => {
                    audio_codec = s.codec_name.clone();
                }
                _ => {}
            }
        }
    }

    let container = probe
        .format
        .as_ref()
        .and_then(|f| f.format_name.clone())
        .map(|names| names.split(',').next().unwrap_or(&names).to_string());

    let direct = is_direct_playable(
        container.as_deref(),
        video_codec.as_deref(),
        audio_codec.as_deref(),
    );
    VideoPlaybackProbeRes {
        direct_playable: direct,
        needs_transcode: !direct,
        video_codec,
        audio_codec,
        container,
    }
}

/// 浏览器 `<video>` 直链可播的常见组合（不含 HEVC / MKV 等）。
fn is_direct_playable(
    container: Option<&str>,
    video_codec: Option<&str>,
    audio_codec: Option<&str>,
) -> bool {
    let v = video_codec.unwrap_or("");
    let a = audio_codec;
    let c = container.unwrap_or("");

    let audio_ok = match a {
        None => true,
        Some("") => true,
        Some("aac") | Some("mp3") | Some("opus") => true,
        _ => false,
    };

    if !audio_ok {
        return false;
    }

    match c {
        "mp4" | "mov" | "m4v" | "3gp" | "3g2" => matches!(v, "h264" | "avc"),
        "webm" => matches!(v, "vp8" | "vp9" | "av1"),
        "ogg" => matches!(v, "theora"),
        _ => false,
    }
}
