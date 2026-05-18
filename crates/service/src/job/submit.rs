//! 任务提交辅助（批量入队等）。

use anyhow::{Result, bail};
use ma_subtitle::types::SubtitleGenerateConfig;
use serde::{Deserialize, Serialize};
use taskmill::{SubmitOutcome, TypedTask};
use typeshare::typeshare;

use super::storage::TaskmillRuntime;
use super::types::VideoSubtitleGenerateTask;

/// 提交单条字幕生成任务（`video_path` 与识别/翻译配置分离）。
#[typeshare]
#[derive(Clone, Deserialize, Serialize)]
pub struct SubtitleGenerateReq {
    pub video_path: String,
    pub config: Option<SubtitleGenerateConfig>,
}

#[typeshare]
#[derive(Deserialize)]
pub struct SubtitleGenerateBulkReq {
    pub video_paths: Vec<String>,
    pub config: Option<SubtitleGenerateConfig>,
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

fn resolve_generate_config(config: Option<SubtitleGenerateConfig>) -> SubtitleGenerateConfig {
    config.unwrap_or_default()
}

pub async fn enqueue_subtitle_generate(
    runtime: &TaskmillRuntime,
    req: SubtitleGenerateReq,
) -> Result<SubmitOutcome> {
    let video_path = req.video_path.trim().to_string();
    if video_path.is_empty() {
        bail!("video_path 不能为空");
    }
    runtime
        .enqueue_generate(VideoSubtitleGenerateTask {
            video_path,
            config: resolve_generate_config(req.config),
        })
        .await
}

pub async fn bulk_enqueue_subtitle_generate(
    runtime: &TaskmillRuntime,
    req: SubtitleGenerateBulkReq,
) -> Result<SubtitleGenerateBulkRes> {
    if req.video_paths.is_empty() {
        bail!("video_paths 不能为空");
    }

    let shared_config = resolve_generate_config(req.config);
    let skip_if_exists = req.skip_if_exists.unwrap_or(true);
    let mut active_video_paths = active_generate_video_paths(runtime).await;

    let mut submitted = Vec::new();
    let mut skipped = Vec::new();
    let mut failed = Vec::new();

    for raw in req.video_paths {
        let video_path = raw.trim().to_string();
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
            .enqueue_generate(VideoSubtitleGenerateTask {
                video_path: video_path.clone(),
                config: shared_config.clone(),
            })
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
            let p = wrapped.video_path.trim().to_string();
            if !p.is_empty() {
                paths.insert(p);
            }
        }
    }
    paths
}
