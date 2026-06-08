//! Taskmill SQLite 持久化调度器（与业务 DB 分离）。

use std::{collections::VecDeque, path::PathBuf, sync::Arc, time::Duration};

use tokio::sync::Mutex;

use anyhow::Context;
use chrono::Utc;
use ma_utils::config::get_app_data_dir;
use serde::Serialize;
use taskmill::{
    Domain, DomainHandle, MetricsSnapshot, Scheduler, SchedulerEvent, SchedulerSnapshot,
    SubmitOutcome, TaskHistoryRecord,
};
use tokio_util::sync::CancellationToken;
use utoipa::ToSchema;

use super::setup_download_exec::{FfmpegSetupDownloadExecutor, WhisperModelDownloadExecutor};
use super::spawn::{
    SubtitleTranslateExecutor, VideoSubtitleExtractWavExecutor, VideoSubtitleGenerateExecutor,
    VideoSubtitleRecognizeExecutor,
};
use super::types::{
    FfmpegSetupDownloadTask, GROUP_MEDIA_SCAN, GROUP_SETUP_DOWNLOAD, GROUP_SUBTITLE_PIPELINE,
    GROUP_TRANSLATE, GROUP_WHISPER, MediaJobsDomain, MediaLibraryScanTask, SubtitleTranslateJob,
    VideoSubtitleExtractWavTask, VideoSubtitleGenerateTask, VideoSubtitleRecognizeTask,
    WhisperModelDownloadTask,
};

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TaskmillSnapshot {
    #[schema(value_type = serde_json::Value)]
    pub scheduler: SchedulerSnapshot,
    #[schema(value_type = serde_json::Value)]
    pub metrics: MetricsSnapshot,
}

/// 一条带接收时间的调度器事件，供任务页展示「执行中」流式日志。
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TimestampedSchedulerEvent {
    pub received_at: chrono::DateTime<Utc>,
    #[schema(value_type = serde_json::Value)]
    pub event: SchedulerEvent,
}

const EXEC_EVENT_LOG_CAP: usize = 400;

const DEFAULT_MAX_CONCURRENCY: usize = 8;
const DEFAULT_GROUP_SUBTITLE_PIPELINE: usize = 2;
const DEFAULT_GROUP_WHISPER: usize = 2;
const DEFAULT_GROUP_TRANSLATE: usize = 2;
const DEFAULT_GROUP_SETUP_DOWNLOAD: usize = 1;
const DEFAULT_GROUP_MEDIA_SCAN: usize = 1;

/// 调度器全局并发与各资源组上限（可由环境变量覆盖）。
struct SchedulerConcurrencyLimits {
    max_concurrency: usize,
    subtitle_pipeline: usize,
    whisper: usize,
    translate: usize,
    setup_download: usize,
    media_scan: usize,
}

fn scheduler_concurrency_limits() -> SchedulerConcurrencyLimits {
    SchedulerConcurrencyLimits {
        max_concurrency: env_usize("TASKMILL_MAX_CONCURRENCY", DEFAULT_MAX_CONCURRENCY),
        subtitle_pipeline: env_usize(
            "TASKMILL_GROUP_SUBTITLE_PIPELINE",
            DEFAULT_GROUP_SUBTITLE_PIPELINE,
        ),
        whisper: env_usize("TASKMILL_GROUP_WHISPER", DEFAULT_GROUP_WHISPER),
        translate: env_usize("TASKMILL_GROUP_TRANSLATE", DEFAULT_GROUP_TRANSLATE),
        setup_download: env_usize(
            "TASKMILL_GROUP_SETUP_DOWNLOAD",
            DEFAULT_GROUP_SETUP_DOWNLOAD,
        ),
        media_scan: env_usize("TASKMILL_GROUP_MEDIA_SCAN", DEFAULT_GROUP_MEDIA_SCAN),
    }
}

/// 设置页下载 executor 共享依赖。
#[derive(Clone)]
pub struct SetupDownloadDeps {
    pub http_client: reqwest::Client,
    pub staging_lock: Arc<Mutex<()>>,
}

/// 媒体库扫描 executor 共享依赖。
#[derive(Clone)]
pub struct MediaLibraryScanDeps {
    pub db: ma_db::SqlitePool,
}

fn env_usize(name: &str, default: usize) -> usize {
    match std::env::var(name) {
        Ok(s) => s.trim().parse().unwrap_or(default).max(1),
        Err(_) => default,
    }
}

#[derive(Clone)]
pub struct TaskmillRuntime {
    pub scheduler: Scheduler,
    pub domain: DomainHandle<MediaJobsDomain>,
    pub cancellation: CancellationToken,
    pub setup_download_deps: SetupDownloadDeps,
    pub media_library_scan_deps: MediaLibraryScanDeps,
    exec_event_log: Arc<tokio::sync::Mutex<VecDeque<TimestampedSchedulerEvent>>>,
}

impl TaskmillRuntime {
    /// 连接独立 SQLite，并构造 Taskmill 调度器与 typed domain。
    pub async fn setup(db: ma_db::SqlitePool) -> anyhow::Result<Self> {
        let db_path = taskmill_sqlite_path().context("解析 TASKMILL_SQLITE / 默认路径")?;
        if let Some(parent) = db_path.parent() {
            let parent_display = parent.display().to_string();
            tokio::fs::create_dir_all(&parent)
                .await
                .with_context(|| format!("创建目录 {parent_display}"))?;
        }

        let store_path = db_path.to_string_lossy();
        let limits = scheduler_concurrency_limits();
        tracing::info!(
            max_concurrency = limits.max_concurrency,
            group_subtitle_pipeline = limits.subtitle_pipeline,
            group_whisper = limits.whisper,
            group_translate = limits.translate,
            group_setup_download = limits.setup_download,
            group_media_scan = limits.media_scan,
            "taskmill 并发：全局与各资源组上限"
        );

        let http_client = reqwest::Client::builder()
            .user_agent("media-admin/0.1")
            .build()
            .context("构建设置页下载 HTTP 客户端失败")?;
        let setup_download_deps = SetupDownloadDeps {
            http_client,
            staging_lock: Arc::new(Mutex::new(())),
        };
        let whisper_dl_exec = WhisperModelDownloadExecutor::new(setup_download_deps.clone());
        let ffmpeg_dl_exec = FfmpegSetupDownloadExecutor::new(setup_download_deps.clone());
        let media_library_scan_deps = MediaLibraryScanDeps { db };
        let media_scan_exec =
            super::spawn::MediaLibraryScanExecutor::new(media_library_scan_deps.clone());
        let scheduler = Scheduler::builder()
            .store_path(&store_path)
            .domain(
                Domain::<MediaJobsDomain>::new()
                    .task::<VideoSubtitleGenerateTask>(VideoSubtitleGenerateExecutor)
                    .task::<VideoSubtitleExtractWavTask>(VideoSubtitleExtractWavExecutor)
                    .task::<VideoSubtitleRecognizeTask>(VideoSubtitleRecognizeExecutor)
                    .task::<SubtitleTranslateJob>(SubtitleTranslateExecutor)
                    .task::<MediaLibraryScanTask>(media_scan_exec)
                    .task::<WhisperModelDownloadTask>(whisper_dl_exec)
                    .task::<FfmpegSetupDownloadTask>(ffmpeg_dl_exec),
            )
            .max_concurrency(limits.max_concurrency)
            .group_concurrency(GROUP_SUBTITLE_PIPELINE, limits.subtitle_pipeline)
            .group_concurrency(GROUP_WHISPER, limits.whisper)
            .group_concurrency(GROUP_TRANSLATE, limits.translate)
            .group_concurrency(GROUP_SETUP_DOWNLOAD, limits.setup_download)
            .group_concurrency(GROUP_MEDIA_SCAN, limits.media_scan)
            .group_minimum_slots(GROUP_TRANSLATE, 1)
            .poll_interval(Duration::from_millis(250))
            .progress_interval(Duration::from_millis(250))
            .build()
            .await
            .context("构建 taskmill 调度器失败")?;
        let domain = scheduler.domain::<MediaJobsDomain>();
        let cancellation = CancellationToken::new();

        let exec_event_log = Arc::new(tokio::sync::Mutex::new(VecDeque::new()));
        {
            let sched = scheduler.clone();
            let log = exec_event_log.clone();
            tokio::spawn(async move {
                let mut rx = sched.subscribe();
                loop {
                    match rx.recv().await {
                        Ok(ev) => {
                            let mut g = log.lock().await;
                            g.push_back(TimestampedSchedulerEvent {
                                received_at: Utc::now(),
                                event: ev,
                            });
                            while g.len() > EXEC_EVENT_LOG_CAP {
                                g.pop_front();
                            }
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                            tracing::debug!("taskmill exec log: broadcast lagged, dropped samples");
                        }
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            });
        }

        // 应用启动时不自动派发队列中的任务，由用户在任务页手动「恢复任务调度」。
        scheduler.pause_all().await;
        tracing::info!("taskmill 调度器已默认暂停，待用户手动恢复后才开始执行任务");

        Ok(Self {
            scheduler,
            domain,
            cancellation,
            setup_download_deps,
            media_library_scan_deps,
            exec_event_log,
        })
    }

    pub async fn enqueue_generate(
        &self,
        input: VideoSubtitleGenerateTask,
    ) -> anyhow::Result<SubmitOutcome> {
        self.domain
            .submit(input)
            .await
            .context("提交视频字幕生成任务失败")
    }

    pub async fn enqueue_translate(
        &self,
        input: SubtitleTranslateJob,
    ) -> anyhow::Result<SubmitOutcome> {
        self.domain
            .submit(input)
            .await
            .context("提交字幕翻译任务失败")
    }

    /// 入队媒体库扫描。
    pub async fn enqueue_media_library_scan(
        &self,
        input: MediaLibraryScanTask,
    ) -> anyhow::Result<SubmitOutcome> {
        self.domain
            .submit(input)
            .await
            .context("提交媒体库扫描任务失败")
    }

    /// 入队 Whisper 模型下载。
    pub async fn enqueue_whisper_model_download(
        &self,
        input: WhisperModelDownloadTask,
    ) -> anyhow::Result<SubmitOutcome> {
        self.domain
            .submit(input)
            .await
            .context("提交 Whisper 模型下载任务失败")
    }

    /// 入队 FFmpeg 下载安装。
    pub async fn enqueue_ffmpeg_setup_download(
        &self,
        input: FfmpegSetupDownloadTask,
    ) -> anyhow::Result<SubmitOutcome> {
        self.domain
            .submit(input)
            .await
            .context("提交 FFmpeg 下载任务失败")
    }

    pub async fn snapshot(&self) -> anyhow::Result<TaskmillSnapshot> {
        let scheduler = self
            .scheduler
            .snapshot()
            .await
            .context("读取 taskmill 快照失败")?;
        let metrics = self.scheduler.metrics_snapshot().await;
        Ok(TaskmillSnapshot { scheduler, metrics })
    }

    pub async fn recent_history(
        &self,
        limit: i32,
        offset: i32,
    ) -> anyhow::Result<Vec<TaskHistoryRecord>> {
        self.scheduler
            .store()
            .history(limit, offset)
            .await
            .context("读取 taskmill 任务历史失败")
    }

    pub async fn recent_exec_events(&self, limit: usize) -> Vec<TimestampedSchedulerEvent> {
        let limit = limit.clamp(1, 500);
        let guard = self.exec_event_log.lock().await;
        let skip = guard.len().saturating_sub(limit);
        guard.iter().skip(skip).cloned().collect()
    }
}

fn taskmill_sqlite_path() -> anyhow::Result<PathBuf> {
    let path = match std::env::var("TASKMILL_SQLITE") {
        Ok(s) => PathBuf::from(s.trim()),
        Err(_) => get_app_data_dir()?.join("taskmill.sqlite"),
    };

    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
}
