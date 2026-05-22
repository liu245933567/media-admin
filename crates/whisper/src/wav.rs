use anyhow::{Context, Result, anyhow, bail, ensure};
use ma_utils::config::get_ffmpeg_bin_path;
use std::path::Path;

use tokio::io::AsyncReadExt;

/// [`CREATE_NO_WINDOW`]：避免在无控制台父进程（如 GUI）下启动控制台子系统程序时出现闪窗。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 与落盘提取共用的 ffmpeg 音频参数（16k 单声道 + 降噪/响度归一化）。
fn push_audio_extract_args(cmd: &mut tokio::process::Command) {
    cmd.args([
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-af",
        "highpass=f=80,dynaudnorm=f=150:g=15:p=0.95",
    ]);
}

/// 从视频经 ffmpeg 管道提取 16kHz 单声道 PCM（s16le），不落盘。
pub async fn extract_pcm_i16_mono16k(input_video_path: &Path) -> Result<Vec<i16>> {
    let ffmpeg = get_ffmpeg_bin_path()?;

    tracing::info!("经管道提取 PCM: {}", input_video_path.display());

    let mut cmd = tokio::process::Command::new(&ffmpeg);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.args(["-nostdin", "-hide_banner", "-nostats", "-loglevel", "error"])
        .arg("-i")
        .arg(input_video_path)
        .stdin(std::process::Stdio::null());
    push_audio_extract_args(&mut cmd);
    cmd.args(["-f", "s16le"])
        .arg("pipe:1")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| anyhow!("运行 ffmpeg 失败(ffmpeg={ffmpeg}): {e}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("ffmpeg stdout 不可用"))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("ffmpeg stderr 不可用"))?;

    let mut pcm_bytes = Vec::new();
    let mut stderr_bytes = Vec::new();
    let (stdout_res, stderr_res) = tokio::join!(
        stdout.read_to_end(&mut pcm_bytes),
        stderr.read_to_end(&mut stderr_bytes),
    );
    stdout_res.context("读取 ffmpeg PCM 输出失败")?;
    stderr_res.context("读取 ffmpeg stderr 失败")?;

    let status = child.wait().await?;
    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr_bytes);
        bail!(
            "ffmpeg 退出码异常: {status}. {stderr}请确认 ffmpeg 可用，或设置环境变量 FFMPEG_PATH 指向可执行文件。"
        );
    }

    ensure!(
        pcm_bytes.len() % 2 == 0,
        "PCM 字节长度必须为偶数，当前 {} 字节",
        pcm_bytes.len()
    );
    ensure!(!pcm_bytes.is_empty(), "ffmpeg 未输出任何 PCM 数据");

    let samples: Vec<i16> = pcm_bytes
        .chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect();

    tracing::info!(
        samples = samples.len(),
        dur_s = samples.len() as f64 / 16_000.0,
        "管道 PCM 提取完成"
    );

    Ok(samples)
}
