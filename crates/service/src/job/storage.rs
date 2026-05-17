//! Taskmill SQLite 持久化调度器（与业务 DB 分离）。

use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

use anyhow::Context;
use chrono::Utc;
use ma_utils::config::get_app_data_dir;
use serde::Serialize;
use taskmill::{
    Domain, DomainHandle, MetricsSnapshot, Scheduler, SchedulerEvent, SchedulerSnapshot,
    SubmitOutcome, TaskHistoryRecord,
};
use tokio_util::sync::CancellationToken;

use super::spawn::{
    ExtractWavExecutor, SubtitleTranslateExecutor, VideoSubtitleGenerateExecutor,
    WhisperVadSrtExecutor,
};
use super::types::{
    ExtractWavTask, MediaJobsDomain, SubtitleTranslateJob, VideoSubtitleGenerateTask,
    WhisperVadSrtTask, GROUP_FFMPEG, GROUP_TRANSLATE, GROUP_WHISPER,
};

#[derive(Debug, Clone, Serialize)]
pub struct TaskmillSnapshot {
    pub scheduler: SchedulerSnapshot,
    pub metrics: MetricsSnapshot,
}

/// 一条带接收时间的调度器事件，供任务页展示「执行中」流式日志。
#[derive(Debug, Clone, Serialize)]
pub struct TimestampedSchedulerEvent {
    pub received_at: chrono::DateTime<Utc>,
    pub event: SchedulerEvent,
}

const EXEC_EVENT_LOG_CAP: usize = 400;

const DEFAULT_MAX_CONCURRENCY: usize = 8;
const DEFAULT_GROUP_FFMPEG: usize = 2;
const DEFAULT_GROUP_WHISPER: usize = 1;
const DEFAULT_GROUP_TRANSLATE: usize = 2;

/// 调度器全局并发与各资源组上限（可由环境变量覆盖）。
struct SchedulerConcurrencyLimits {
    max_concurrency: usize,
    ffmpeg: usize,
    whisper: usize,
    translate: usize,
}

fn scheduler_concurrency_limits() -> SchedulerConcurrencyLimits {
    SchedulerConcurrencyLimits {
        max_concurrency: env_usize("TASKMILL_MAX_CONCURRENCY", DEFAULT_MAX_CONCURRENCY),
        ffmpeg: env_usize("TASKMILL_GROUP_FFMPEG", DEFAULT_GROUP_FFMPEG),
        whisper: env_usize("TASKMILL_GROUP_WHISPER", DEFAULT_GROUP_WHISPER),
        translate: env_usize("TASKMILL_GROUP_TRANSLATE", DEFAULT_GROUP_TRANSLATE),
    }
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
    exec_event_log: Arc<tokio::sync::Mutex<VecDeque<TimestampedSchedulerEvent>>>,
}

impl TaskmillRuntime {
    /// 连接独立 SQLite，并构造 Taskmill 调度器与 typed domain。
    pub async fn setup() -> anyhow::Result<Self> {
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
            group_ffmpeg = limits.ffmpeg,
            group_whisper = limits.whisper,
            group_translate = limits.translate,
            "taskmill 并发：全局与各资源组上限"
        );

        let scheduler = Scheduler::builder()
            .store_path(&store_path)
            .domain(
                Domain::<MediaJobsDomain>::new()
                    .task::<VideoSubtitleGenerateTask>(VideoSubtitleGenerateExecutor)
                    .task::<ExtractWavTask>(ExtractWavExecutor)
                    .task::<WhisperVadSrtTask>(WhisperVadSrtExecutor)
                    .task::<SubtitleTranslateJob>(SubtitleTranslateExecutor),
            )
            .max_concurrency(limits.max_concurrency)
            .group_concurrency(GROUP_FFMPEG, limits.ffmpeg)
            .group_concurrency(GROUP_WHISPER, limits.whisper)
            .group_concurrency(GROUP_TRANSLATE, limits.translate)
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

        Ok(Self {
            scheduler,
            domain,
            cancellation,
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

    pub async fn snapshot(&self) -> anyhow::Result<TaskmillSnapshot> {
        let scheduler = self
            .scheduler
            .snapshot()
            .await
            .context("读取 taskmill 快照失败")?;
        let metrics = self.scheduler.metrics_snapshot().await;
        Ok(TaskmillSnapshot {
            scheduler,
            metrics,
        })
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
