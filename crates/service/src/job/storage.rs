//! Taskmill SQLite 演示库与任务提交入口。

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

use super::spawn::{TranslateOnlyExecutor, VideoPipelineExecutor};
use super::types::{TaskmillDemoDomain, TranslateSubtitleOnlyInput, VideoSubtitlePipelineInput};

#[derive(Debug, Clone, Serialize)]
pub struct TaskmillDemoSnapshot {
    pub scheduler: SchedulerSnapshot,
    pub metrics: MetricsSnapshot,
}

/// 一条带接收时间的调度器事件，供演示页展示「执行中」流式日志。
#[derive(Debug, Clone, Serialize)]
pub struct TimestampedSchedulerEvent {
    pub received_at: chrono::DateTime<Utc>,
    pub event: SchedulerEvent,
}

const EXEC_EVENT_LOG_CAP: usize = 400;

#[derive(Clone)]
pub struct TaskmillDemo {
    pub scheduler: Scheduler,
    pub domain: DomainHandle<TaskmillDemoDomain>,
    pub cancellation: CancellationToken,
    exec_event_log: Arc<tokio::sync::Mutex<VecDeque<TimestampedSchedulerEvent>>>,
}

impl TaskmillDemo {
    /// 连接独立 SQLite，并构造 Taskmill 调度器与 typed domain。
    pub async fn setup() -> anyhow::Result<Self> {
        let db_path =
            taskmill_demo_sqlite_path().context("解析 TASKMILL_DEMO_SQLITE / 默认路径")?;
        if let Some(parent) = db_path.parent() {
            let parent_display = parent.display().to_string();
            tokio::fs::create_dir_all(&parent)
                .await
                .with_context(|| format!("创建目录 {parent_display}"))?;
        }

        let store_path = db_path.to_string_lossy();
        let scheduler = Scheduler::builder()
            .store_path(&store_path)
            .domain(
                Domain::<TaskmillDemoDomain>::new()
                    .task::<VideoSubtitlePipelineInput>(VideoPipelineExecutor)
                    .task::<TranslateSubtitleOnlyInput>(TranslateOnlyExecutor)
                    .max_concurrency(2),
            )
            .max_concurrency(4)
            .poll_interval(Duration::from_millis(250))
            .progress_interval(Duration::from_millis(250))
            .build()
            .await
            .context("构建 taskmill 演示调度器失败")?;
        let domain = scheduler.domain::<TaskmillDemoDomain>();
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
                            tracing::debug!("taskmill demo exec log: broadcast lagged, dropped samples");
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

    pub async fn enqueue_video_pipeline(
        &self,
        input: VideoSubtitlePipelineInput,
    ) -> anyhow::Result<SubmitOutcome> {
        self.domain
            .submit(input)
            .await
            .context("提交 taskmill 视频流水线任务失败")
    }

    pub async fn enqueue_translate_only(
        &self,
        input: TranslateSubtitleOnlyInput,
    ) -> anyhow::Result<SubmitOutcome> {
        self.domain
            .submit(input)
            .await
            .context("提交 taskmill 仅翻译字幕任务失败")
    }

    pub async fn snapshot(&self) -> anyhow::Result<TaskmillDemoSnapshot> {
        let scheduler = self
            .scheduler
            .snapshot()
            .await
            .context("读取 taskmill 演示快照失败")?;
        let metrics = self.scheduler.metrics_snapshot().await;
        Ok(TaskmillDemoSnapshot { scheduler, metrics })
    }

    /// 按 `completed_at` 倒序读取 `task_history`（含失败、取消等终态；标签列可能为空，见 taskmill 文档）。
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

    /// 最近若干条调度器事件（时间正序），来自 `Scheduler::subscribe()`，含派发、进度文案、完成/失败等。
    pub async fn recent_exec_events(&self, limit: usize) -> Vec<TimestampedSchedulerEvent> {
        let limit = limit.clamp(1, 500);
        let guard = self.exec_event_log.lock().await;
        let skip = guard.len().saturating_sub(limit);
        guard.iter().skip(skip).cloned().collect()
    }
}

/// 默认文件为 `get_app_data_dir()/taskmill_demo.sqlite`。
fn taskmill_demo_sqlite_path() -> anyhow::Result<PathBuf> {
    let path = match std::env::var("TASKMILL_DEMO_SQLITE") {
        Ok(s) => {
            let t = s.trim();
            PathBuf::from(t)
        }
        Err(_) => get_app_data_dir()?.join("taskmill_demo.sqlite"),
    };

    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(std::env::current_dir()?.join(path))
    }
}
