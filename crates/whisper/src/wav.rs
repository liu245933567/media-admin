use anyhow::{Result, anyhow, bail};
use ma_utils::config::{get_ffmpeg_bin_path, get_temp_wav_dir};
use std::path::{Path, PathBuf};

// #[cfg(windows)]
// use std::os::windows::process::CommandExt;

/// [`CREATE_NO_WINDOW`]：避免在无控制台父进程（如 GUI）下启动控制台子系统程序时出现闪窗。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 提取 16k 单声道 WAV 文件
pub async fn extract_wav_16k_mono(input_video_path: &Path) -> Result<PathBuf> {
    let temp_wav_dir = get_temp_wav_dir();

    tokio::fs::create_dir_all(&temp_wav_dir).await?;

    let output_wav = temp_wav_dir.join(format!(
        "{}.wav",
        input_video_path.file_name().unwrap().to_string_lossy()
    ));

    let ffmpeg = get_ffmpeg_bin_path()?;

    tracing::info!("开始提取 wav 文件: {}", input_video_path.display());

    // -af 链：
    //   highpass=f=80   去除空调/风噪等低频隆隆声
    //   dynaudnorm      逐帧响度归一化，让全片音量一致，避免低音量段被 whisper 当成静音
    let mut cmd = tokio::process::Command::new(&ffmpeg);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let status = cmd
        .arg("-y")
        .arg("-i")
        .arg(input_video_path)
        .args([
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-af",
            "highpass=f=80,dynaudnorm=f=150:g=15:p=0.95",
        ])
        .arg("-f")
        .arg("wav")
        .arg(&output_wav)
        .status()
        .await
        .map_err(|e| anyhow!("运行 ffmpeg 失败(ffmpeg={ffmpeg}): {e}"))?;

    if !status.success() {
        bail!(
            "ffmpeg 退出码异常: {}. 请确认 ffmpeg 可用，或设置环境变量 FFMPEG_PATH 指向可执行文件。",
            status
        );
    }

    Ok(output_wav)
}
