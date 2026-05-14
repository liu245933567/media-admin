//! Taskmill SQLite 演示库与任务提交入口。

use std::{path::PathBuf, time::Duration};

use anyhow::Context;
use ma_utils::config::get_app_data_dir;
use serde::Serialize;
use taskmill::{
    Domain, DomainHandle, MetricsSnapshot, Scheduler, SchedulerSnapshot, SubmitOutcome,
};
use tokio_util::sync::CancellationToken;

use super::spawn::{TranslateOnlyExecutor, VideoPipelineExecutor};
use super::types::{TaskmillDemoDomain, TranslateSubtitleOnlyInput, VideoSubtitlePipelineInput};

#[derive(Debug, Clone, Serialize)]
pub struct TaskmillDemoSnapshot {
    pub scheduler: SchedulerSnapshot,
    pub metrics: MetricsSnapshot,
}

#[derive(Clone)]
pub struct TaskmillDemo {
    pub scheduler: Scheduler,
    pub domain: DomainHandle<TaskmillDemoDomain>,
    pub cancellation: CancellationToken,
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

        Ok(Self {
            scheduler,
            domain,
            cancellation,
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
