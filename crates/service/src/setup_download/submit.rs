//! 设置页下载任务入队（Taskmill）。

use anyhow::{Result, anyhow, bail};
use ma_utils::config::{ffmpeg_tool_installed, get_models_dir};
use taskmill::SubmitOutcome;

use crate::job::{FfmpegSetupDownloadTask, TaskmillRuntime, WhisperModelDownloadTask};

use super::catalog::whisper_catalog;
use super::types::WhisperDownloadStartReq;

/// 从 [`SubmitOutcome`] 解析 Taskmill 任务 ID。
pub fn submit_outcome_task_id(outcome: SubmitOutcome) -> Result<i64> {
    match outcome {
        SubmitOutcome::Duplicate => {
            bail!("setup_download_blocked:duplicate");
        }
        SubmitOutcome::Rejected => {
            bail!("setup_download_blocked:rejected");
        }
        other => other
            .id()
            .ok_or_else(|| anyhow!("提交下载任务失败：无任务 ID")),
    }
}

/// 入队 Whisper 模型下载（提交前校验模型与本地文件）。
pub async fn enqueue_whisper_model_download(
    runtime: &TaskmillRuntime,
    body: WhisperDownloadStartReq,
) -> Result<SubmitOutcome> {
    let item = whisper_catalog()
        .into_iter()
        .find(|m| m.id == body.model_id)
        .ok_or_else(|| anyhow!("未知模型 id: {}", body.model_id))?;

    if get_models_dir().join(&item.filename).is_file() {
        bail!("whisper_download_blocked:already_present");
    }

    runtime
        .enqueue_whisper_model_download(WhisperModelDownloadTask {
            model_id: body.model_id,
        })
        .await
}

/// 入队 FFmpeg 下载安装。
pub async fn enqueue_ffmpeg_setup_download(runtime: &TaskmillRuntime) -> Result<SubmitOutcome> {
    if ffmpeg_tool_installed() {
        bail!("ffmpeg_download_blocked:already_present");
    }

    runtime
        .enqueue_ffmpeg_setup_download(FfmpegSetupDownloadTask)
        .await
}
