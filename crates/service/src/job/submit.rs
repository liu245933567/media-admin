//! 任务提交辅助（批量入队等）。

use anyhow::{Result, bail};
use ma_subtitle::types::SubtitleGenerateConfig;
use serde::{Deserialize, Serialize};
use taskmill::{SubmitOutcome, TypedTask};
use typeshare::typeshare;

use super::storage::TaskmillRuntime;
use super::types::VideoSubtitleGenerateTask;

#[typeshare]
#[derive(Deserialize)]
pub struct SubtitleGenerateBulkReq {
    pub configs: Vec<SubtitleGenerateConfig>,
    /// 若同 video_path 已有 pending/running 生成任务则跳过（默认 true）
    pub skip_if_exists: Option<bool>,
}

#[typeshare]
#[derive(Clone, Serialize)]
pub struct SubtitleGenerateBulkFailedItem {
    pub video_path: String,
    pub error: String,
}

#[typeshare]
#[derive(Serialize)]
pub struct SubtitleGenerateBulkRes {
    pub submitted: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<SubtitleGenerateBulkFailedItem>,
}

/// 新建任务表单的默认配置。
#[typeshare]
#[derive(Serialize)]
pub struct SubtitleGenerateDefaultsRes {
    pub config: SubtitleGenerateConfig,
}

pub fn subtitle_generate_defaults() -> SubtitleGenerateDefaultsRes {
    SubtitleGenerateDefaultsRes {
        config: SubtitleGenerateConfig::default(),
    }
}

pub async fn enqueue_subtitle_generate(
    runtime: &TaskmillRuntime,
    config: SubtitleGenerateConfig,
) -> Result<SubmitOutcome> {
    let video_path = config.video_path.trim().to_string();
    if video_path.is_empty() {
        bail!("video_path 不能为空");
    }
    runtime
        .enqueue_generate(VideoSubtitleGenerateTask(config))
        .await
}

pub async fn bulk_enqueue_subtitle_generate(
    runtime: &TaskmillRuntime,
    req: SubtitleGenerateBulkReq,
) -> Result<SubtitleGenerateBulkRes> {
    if req.configs.is_empty() {
        bail!("configs 不能为空");
    }

    let skip_if_exists = req.skip_if_exists.unwrap_or(true);
    let mut active_video_paths = active_generate_video_paths(runtime).await;

    let mut submitted = Vec::new();
    let mut skipped = Vec::new();
    let mut failed = Vec::new();

    for cfg in req.configs {
        let video_path = cfg.video_path.trim().to_string();
        if video_path.is_empty() {
            failed.push(SubtitleGenerateBulkFailedItem {
                video_path,
                error: "video_path 不能为空".to_string(),
            });
            continue;
        }

        if skip_if_exists && active_video_paths.contains(&video_path) {
            skipped.push(video_path);
            continue;
        }

        match runtime
            .enqueue_generate(VideoSubtitleGenerateTask(cfg))
            .await
        {
            Ok(_) => {
                active_video_paths.insert(video_path.clone());
                submitted.push(video_path);
            }
            Err(e) => failed.push(SubtitleGenerateBulkFailedItem {
                video_path,
                error: e.to_string(),
            }),
        }
    }

    Ok(SubtitleGenerateBulkRes {
        submitted,
        skipped,
        failed,
    })
}

async fn active_generate_video_paths(
    runtime: &TaskmillRuntime,
) -> std::collections::HashSet<String> {
    use std::collections::HashSet;

    let mut paths = HashSet::new();
    let Ok(tasks) = runtime.scheduler.store().all_active_tasks().await else {
        return paths;
    };

    for task in tasks {
        if task.task_type != VideoSubtitleGenerateTask::TASK_TYPE {
            continue;
        }
        let Some(payload) = task.payload.as_ref() else {
            continue;
        };
        if let Ok(wrapped) = serde_json::from_slice::<VideoSubtitleGenerateTask>(payload) {
            let p = wrapped.0.video_path.trim().to_string();
            if !p.is_empty() {
                paths.insert(p);
            }
        }
    }
    paths
}
