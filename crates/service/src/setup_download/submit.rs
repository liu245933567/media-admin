//! 设置页下载任务入队（Taskmill）。

use anyhow::{Result, anyhow, bail};
use ma_utils::config::{ffmpeg_tool_installed, get_models_dir};
use taskmill::SubmitOutcome;

use crate::job::{FfmpegSetupDownloadTask, TaskmillRuntime, WhisperModelDownloadTask};

use super::catalog::whisper_catalog;
use super::types::WhisperDownloadStartReq;

const FFMPEG_SETUP_DOWNLOAD_KEY: &str = "ffmpeg-setup-download";

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

/// 用户从设置页显式触发安装类任务时，若调度器处于启动默认暂停则恢复，否则任务只会入队不执行。
async fn resume_scheduler_for_setup_download(runtime: &TaskmillRuntime) {
    if runtime.scheduler.is_paused() {
        runtime.resume_scheduler().await;
        tracing::info!("设置页安装任务：调度器已从默认暂停恢复");
    }
}

/// 解析入队结果；`Duplicate` 时尝试返回队列中同 key 的活跃任务 id。
async fn resolve_setup_download_task_id(
    runtime: &TaskmillRuntime,
    outcome: SubmitOutcome,
    dedupe_key: &str,
) -> Result<i64> {
    if let Some(id) = outcome.id() {
        return Ok(id);
    }
    if matches!(outcome, SubmitOutcome::Duplicate) {
        let tasks = runtime.list_active_tasks(100).await?;
        if let Some(t) = tasks.into_iter().find(|t| t.key == dedupe_key) {
            tracing::info!(task_id = t.id, "设置页安装任务已存在，复用活跃任务");
            return Ok(t.id);
        }
        bail!("setup_download_blocked:duplicate");
    }
    submit_outcome_task_id(outcome)
}

/// 提交 Whisper 模型下载并返回任务 ID（会恢复因启动而暂停的调度器）。
pub async fn start_whisper_model_download(
    runtime: &TaskmillRuntime,
    body: WhisperDownloadStartReq,
) -> Result<i64> {
    let item = whisper_catalog()
        .into_iter()
        .find(|m| m.id == body.model_id)
        .ok_or_else(|| anyhow!("未知模型 id: {}", body.model_id))?;

    if get_models_dir().join(&item.filename).is_file() {
        bail!("whisper_download_blocked:already_present");
    }

    let dedupe_key = format!("whisper-model-download:{}", body.model_id);
    resume_scheduler_for_setup_download(runtime).await;

    let outcome = runtime
        .enqueue_whisper_model_download(WhisperModelDownloadTask {
            model_id: body.model_id,
        })
        .await?;

    resolve_setup_download_task_id(runtime, outcome, &dedupe_key).await
}

/// 提交 FFmpeg 下载安装并返回任务 ID（会恢复因启动而暂停的调度器）。
pub async fn start_ffmpeg_setup_download(runtime: &TaskmillRuntime) -> Result<i64> {
    if ffmpeg_tool_installed() {
        bail!("ffmpeg_download_blocked:already_present");
    }

    resume_scheduler_for_setup_download(runtime).await;

    let outcome = runtime
        .enqueue_ffmpeg_setup_download(FfmpegSetupDownloadTask)
        .await?;

    resolve_setup_download_task_id(runtime, outcome, FFMPEG_SETUP_DOWNLOAD_KEY).await
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
