//! 设置页下载任务 executor（Whisper 模型 / FFmpeg）。

use ma_utils::config::{ffmpeg_tool_installed, get_models_dir};
use taskmill::{DomainTaskContext, TaskError, TypedExecutor};

use crate::setup_download::catalog::whisper_catalog;
use crate::setup_download::staging::reset_staging_dir;
use crate::setup_download::whisper::{ensure_download_parent, run_whisper_download};

use super::storage::SetupDownloadDeps;
use super::types::{FfmpegSetupDownloadTask, MediaJobsDomain, WhisperModelDownloadTask};

/// Whisper 模型下载 executor。
#[derive(Clone)]
pub struct WhisperModelDownloadExecutor {
    deps: SetupDownloadDeps,
}

impl WhisperModelDownloadExecutor {
    pub fn new(deps: SetupDownloadDeps) -> Self {
        Self { deps }
    }
}

impl TypedExecutor<WhisperModelDownloadTask> for WhisperModelDownloadExecutor {
    async fn execute(
        &self,
        job: WhisperModelDownloadTask,
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        let model_id = job.model_id.trim().to_string();
        if model_id.is_empty() {
            return Err(TaskError::permanent("model_id 不能为空"));
        }

        let item = whisper_catalog()
            .into_iter()
            .find(|m| m.id == model_id)
            .ok_or_else(|| TaskError::permanent(format!("未知模型 id: {model_id}")))?;

        if get_models_dir().join(&item.filename).is_file() {
            return Err(TaskError::permanent(
                "whisper_download_blocked:already_present",
            ));
        }

        let _staging = self.deps.staging_lock.lock().await;
        ensure_download_parent()
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;
        reset_staging_dir()
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;

        ctx.progress()
            .report(0.01, Some(format!("准备下载 {}", item.filename)));

        let progress = crate::setup_download::progress::DownloadProgressHandle::new(ctx.progress());
        let check_cancelled = || ctx.check_cancelled();

        run_whisper_download(&self.deps.http_client, model_id, &progress, check_cancelled)
            .await
            .map_err(|e| {
                let s = e.to_string();
                if s.contains("cancelled") {
                    TaskError::cancelled()
                } else {
                    TaskError::retryable(s)
                }
            })?;

        ctx.progress().report(1.0, Some("模型下载完成".into()));
        Ok(())
    }
}

/// FFmpeg 下载安装 executor。
#[derive(Clone)]
pub struct FfmpegSetupDownloadExecutor {
    deps: SetupDownloadDeps,
}

impl FfmpegSetupDownloadExecutor {
    pub fn new(deps: SetupDownloadDeps) -> Self {
        Self { deps }
    }
}

impl TypedExecutor<FfmpegSetupDownloadTask> for FfmpegSetupDownloadExecutor {
    async fn execute(
        &self,
        _job: FfmpegSetupDownloadTask,
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        if ffmpeg_tool_installed() {
            return Err(TaskError::permanent(
                "ffmpeg_download_blocked:already_present",
            ));
        }

        let _staging = self.deps.staging_lock.lock().await;
        ensure_download_parent()
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;
        reset_staging_dir()
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;

        ctx.progress().report(0.01, Some("准备下载 FFmpeg".into()));

        let progress = crate::setup_download::progress::DownloadProgressHandle::new(ctx.progress());
        let check_cancelled = || ctx.check_cancelled();

        crate::setup_download::ffmpeg::run_ffmpeg_download(
            &self.deps.http_client,
            &progress,
            check_cancelled,
        )
        .await
        .map_err(|e| {
            let s = e.to_string();
            if s.contains("cancelled") {
                TaskError::cancelled()
            } else {
                TaskError::retryable(s)
            }
        })?;

        ctx.progress().report(1.0, Some("FFmpeg 安装完成".into()));
        Ok(())
    }
}
