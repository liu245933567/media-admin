//! 任务提交辅助（批量入队等）。

use anyhow::{Result, bail};
use ma_subtitle::types::{SubtitleGenerateConfig, SubtitleTranslateConfig};
use serde::{Deserialize, Serialize};
use taskmill::{SubmitOutcome, TypedTask};
use typeshare::typeshare;

use crate::app_config::{
    AppConfig, merge_subtitle_generate_config, merge_subtitle_translate_job_config,
};
use crate::media_library::{
    MediaLibraryScanRes, list_media_videos_under_dir, resolve_media_child_dir, scan_media_dir,
};

use super::storage::TaskmillRuntime;
use super::types::{SubtitleTranslateJob, VideoSubtitleGenerateTask};

/// 提交单条字幕生成任务（`video_path` 与识别/翻译配置分离）。
#[typeshare]
#[derive(Clone, Deserialize, Serialize)]
pub struct SubtitleGenerateReq {
    pub video_path: String,
    /// `None` 表示整包采用全局 [`AppConfig`] 对应的默认生成配置。
    pub config: Option<SubtitleGenerateConfig>,
}

#[typeshare]
#[derive(Deserialize)]
pub struct SubtitleGenerateBulkReq {
    pub video_paths: Vec<String>,
    /// `None` 表示整包采用全局默认。
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

#[typeshare]
#[derive(Deserialize)]
pub struct ScanGenerateSubtitleReq {
    pub folder_path: String,
    /// `None` 表示整包采用全局默认。
    pub config: Option<SubtitleGenerateConfig>,
    /// 若同 video_path 已有 pending/running 生成任务则跳过（默认 true）
    pub skip_if_exists: Option<bool>,
}

#[typeshare]
#[derive(Serialize)]
pub struct ScanGenerateSubtitleRes {
    pub scan: MediaLibraryScanRes,
    pub matched_videos: u32,
    pub without_subtitles: u32,
    pub submitted: Vec<String>,
    pub skipped: Vec<String>,
    pub failed: Vec<SubtitleGenerateBulkFailedItem>,
}

/// 新建任务表单的默认配置（来自当前全局 [`AppConfig`]）。
#[typeshare]
#[derive(Serialize)]
pub struct SubtitleGenerateDefaultsRes {
    pub config: SubtitleGenerateConfig,
}

pub fn subtitle_generate_defaults(global: &AppConfig) -> SubtitleGenerateDefaultsRes {
    SubtitleGenerateDefaultsRes {
        config: crate::app_config::app_config_to_generate_defaults(global),
    }
}

/// 独立翻译任务提交体：`config == None` 表示使用全局翻译配置。
#[typeshare]
#[derive(Clone, Deserialize, Serialize)]
pub struct SubtitleTranslateJobReq {
    pub source_srt_path: String,
    pub config: Option<SubtitleTranslateConfig>,
}

pub async fn enqueue_subtitle_generate(
    runtime: &TaskmillRuntime,
    req: SubtitleGenerateReq,
    global: &AppConfig,
) -> Result<SubmitOutcome> {
    let video_path = req.video_path.trim().to_string();
    if video_path.is_empty() {
        bail!("video_path 不能为空");
    }
    let config = merge_subtitle_generate_config(req.config, global);
    runtime
        .enqueue_generate(VideoSubtitleGenerateTask { video_path, config })
        .await
}

pub async fn bulk_enqueue_subtitle_generate(
    runtime: &TaskmillRuntime,
    req: SubtitleGenerateBulkReq,
    global: &AppConfig,
) -> Result<SubtitleGenerateBulkRes> {
    if req.video_paths.is_empty() {
        bail!("video_paths 不能为空");
    }

    let shared_config = merge_subtitle_generate_config(req.config, global);
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

pub async fn scan_and_enqueue_subtitle_generate(
    pool: &ma_db::SqlitePool,
    runtime: &TaskmillRuntime,
    req: ScanGenerateSubtitleReq,
    global: &AppConfig,
) -> Result<ScanGenerateSubtitleRes> {
    let folder_path = req.folder_path.trim();
    if folder_path.is_empty() {
        bail!("folder_path 不能为空");
    }

    let resolved = resolve_media_child_dir(pool, folder_path).await?;
    let scan = scan_media_dir(pool, resolved.root_id, &resolved.folder_path).await?;
    let videos = list_media_videos_under_dir(pool, resolved.root_id, &resolved.folder_path).await?;
    let target_paths = videos
        .iter()
        .filter(|row| row.subtitle_count == 0)
        .map(|row| row.file_path.clone())
        .collect::<Vec<_>>();
    let matched_videos = u32::try_from(videos.len()).unwrap_or(u32::MAX);
    let without_subtitles = u32::try_from(target_paths.len()).unwrap_or(u32::MAX);

    if target_paths.is_empty() {
        return Ok(ScanGenerateSubtitleRes {
            scan,
            matched_videos,
            without_subtitles,
            submitted: Vec::new(),
            skipped: Vec::new(),
            failed: Vec::new(),
        });
    }

    let enqueue_res = bulk_enqueue_subtitle_generate(
        runtime,
        SubtitleGenerateBulkReq {
            video_paths: target_paths,
            config: req.config,
            skip_if_exists: req.skip_if_exists,
        },
        global,
    )
    .await?;

    Ok(ScanGenerateSubtitleRes {
        scan,
        matched_videos,
        without_subtitles,
        submitted: enqueue_res.submitted,
        skipped: enqueue_res.skipped,
        failed: enqueue_res.failed,
    })
}

/// 合并全局翻译配置后入队（载荷内始终为完整 [`SubtitleTranslateConfig`]）。
pub async fn enqueue_subtitle_translate_req(
    runtime: &TaskmillRuntime,
    req: SubtitleTranslateJobReq,
    global: &AppConfig,
) -> Result<SubmitOutcome> {
    let source_srt_path = req.source_srt_path.trim().to_string();
    if source_srt_path.is_empty() {
        bail!("source_srt_path 不能为空");
    }
    let config = merge_subtitle_translate_job_config(req.config, &global.translate_config);
    runtime
        .enqueue_translate(SubtitleTranslateJob {
            source_srt_path,
            config,
        })
        .await
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
