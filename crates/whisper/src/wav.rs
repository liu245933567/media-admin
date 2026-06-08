use anyhow::{Context, Result, anyhow, bail, ensure};
use ma_utils::config::{get_ffmpeg_bin_path, get_temp_wav_dir};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};

use tokio::io::AsyncReadExt;
use tokio::sync::mpsc::Sender;

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
        "highpass=f=80,afftdn=nf=-25,dynaudnorm=f=150:g=15:p=0.95",
    ]);
}

fn spawn_pcm_extract_command(input_video_path: &Path) -> Result<tokio::process::Command> {
    let ffmpeg = get_ffmpeg_bin_path()?;

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

    Ok(cmd)
}

fn default_wav_cache_path(input_video_path: &Path) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    input_video_path.to_string_lossy().hash(&mut hasher);

    let stem = input_video_path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "audio".to_string());
    get_temp_wav_dir().join(format!("{stem}-{:016x}.whisper-cache.wav", hasher.finish()))
}

/// 从视频提取 16kHz 单声道 PCM WAV 到本地硬盘缓存。
pub async fn extract_wav_i16_mono16k(
    input_video_path: &Path,
    output_wav_path: Option<PathBuf>,
) -> Result<PathBuf> {
    let ffmpeg = get_ffmpeg_bin_path()?;
    let out = output_wav_path.unwrap_or_else(|| default_wav_cache_path(input_video_path));

    if let Some(parent) = out.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .with_context(|| format!("创建 WAV 缓存目录失败: {}", parent.display()))?;
    }

    tracing::info!(
        video = %input_video_path.display(),
        wav = %out.display(),
        "提取 WAV 缓存"
    );

    let mut cmd = tokio::process::Command::new(&ffmpeg);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd.args(["-nostdin", "-hide_banner", "-nostats", "-loglevel", "error"])
        .arg("-y")
        .arg("-i")
        .arg(input_video_path)
        .stdin(std::process::Stdio::null());
    push_audio_extract_args(&mut cmd);
    cmd.args(["-c:a", "pcm_s16le"]).arg(&out);

    let output = cmd
        .output()
        .await
        .map_err(|e| anyhow!("运行 ffmpeg 失败(ffmpeg={ffmpeg}): {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        bail!(
            "ffmpeg 提取 WAV 失败: {}. {stderr}请确认 ffmpeg 可用，或设置环境变量 FFMPEG_PATH 指向可执行文件。",
            output.status
        );
    }

    let meta = tokio::fs::metadata(&out)
        .await
        .with_context(|| format!("读取 WAV 缓存元数据失败: {}", out.display()))?;
    ensure!(meta.len() > 44, "ffmpeg 输出 WAV 为空: {}", out.display());

    Ok(out)
}

/// 从视频经 ffmpeg 管道提取 16kHz 单声道 PCM（s16le），不落盘。
pub async fn extract_pcm_i16_mono16k(input_video_path: &Path) -> Result<Vec<i16>> {
    tracing::info!("经管道提取 PCM: {}", input_video_path.display());

    let mut cmd = spawn_pcm_extract_command(input_video_path)?;
    let ffmpeg = get_ffmpeg_bin_path()?;
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

/// 从视频经 ffmpeg 管道读取 16kHz 单声道 PCM，并按块发送给消费者。
///
/// 消费者关闭时会停止 ffmpeg，便于识别任务失败后尽快释放管道。
pub async fn stream_pcm_i16_mono16k_chunks(
    input_video_path: &Path,
    tx: Sender<Result<Vec<i16>>>,
) -> Result<()> {
    tracing::info!("流式管道提取 PCM: {}", input_video_path.display());

    let mut cmd = spawn_pcm_extract_command(input_video_path)?;
    let ffmpeg = get_ffmpeg_bin_path()?;
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

    let stderr_task = tokio::spawn(async move {
        let mut stderr_bytes = Vec::new();
        let res = stderr.read_to_end(&mut stderr_bytes).await;
        res.map(|_| stderr_bytes)
    });

    let mut buf = vec![0u8; 64 * 1024];
    let mut carry: Option<u8> = None;
    let mut total_samples = 0usize;

    loop {
        let n = stdout
            .read(&mut buf)
            .await
            .context("读取 ffmpeg PCM 输出失败")?;
        if n == 0 {
            break;
        }

        let mut bytes = Vec::with_capacity(n + usize::from(carry.is_some()));
        if let Some(b) = carry.take() {
            bytes.push(b);
        }
        bytes.extend_from_slice(&buf[..n]);

        if bytes.len() % 2 != 0 {
            carry = bytes.pop();
        }

        if bytes.is_empty() {
            continue;
        }

        let samples: Vec<i16> = bytes
            .chunks_exact(2)
            .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        total_samples += samples.len();

        if tx.send(Ok(samples)).await.is_err() {
            let _ = child.kill().await;
            return Ok(());
        }
    }

    if carry.is_some() {
        let _ = tx
            .send(Err(anyhow!("PCM 字节长度必须为偶数，末尾存在残留字节")))
            .await;
    }

    let status = child.wait().await?;
    let stderr_bytes = stderr_task
        .await
        .context("ffmpeg stderr 任务 join 失败")?
        .context("读取 ffmpeg stderr 失败")?;

    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr_bytes);
        let _ = tx
            .send(Err(anyhow!(
                "ffmpeg 退出码异常: {status}. {stderr}请确认 ffmpeg 可用，或设置环境变量 FFMPEG_PATH 指向可执行文件。"
            )))
            .await;
        bail!(
            "ffmpeg 退出码异常: {status}. {stderr}请确认 ffmpeg 可用，或设置环境变量 FFMPEG_PATH 指向可执行文件。"
        );
    }

    ensure!(total_samples != 0, "ffmpeg 未输出任何 PCM 数据");

    tracing::info!(
        samples = total_samples,
        dur_s = total_samples as f64 / 16_000.0,
        "流式管道 PCM 提取完成"
    );

    Ok(())
}
