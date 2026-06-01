//! Taskmill 调度器与任务生命周期控制（暂停队列、取消、历史清理等）。

use anyhow::{Context, bail};
use serde::Serialize;
use taskmill::{PauseReasons, TaskRecord, TaskStatus};
use utoipa::ToSchema;

use super::storage::TaskmillRuntime;

/// 通用成功响应。
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TaskmillControlOk {
    pub ok: bool,
}

/// 取消任务结果。
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TaskmillCancelRes {
    pub cancelled: bool,
}

/// 删除历史记录结果。
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct TaskmillDeleteHistoryRes {
    pub deleted: bool,
}

impl TaskmillRuntime {
    /// 全局暂停调度器：停止派发，运行中任务进入 paused。
    pub async fn pause_scheduler(&self) {
        self.scheduler.pause_all().await;
    }

    /// 全局恢复调度器。
    pub async fn resume_scheduler(&self) {
        self.scheduler.resume_all().await;
    }

    /// 取消指定任务（运行中 / 等待 / pending 等）。
    pub async fn cancel_task(&self, task_id: i64) -> anyhow::Result<bool> {
        self.scheduler.cancel(task_id).await.context("取消任务失败")
    }

    /// 暂停 pending / blocked 任务；运行中任务应使用取消。
    pub async fn pause_task(&self, task_id: i64) -> anyhow::Result<()> {
        let store = self.scheduler.store();
        let task = store
            .task_by_id(task_id)
            .await
            .context("查询任务失败")?
            .ok_or_else(|| anyhow::anyhow!("任务不存在或已结束"))?;

        match task.status {
            TaskStatus::Pending | TaskStatus::Blocked => {
                store
                    .pause(task_id, PauseReasons::PREEMPTION)
                    .await
                    .context("暂停任务失败")?;
                Ok(())
            }
            TaskStatus::Paused => Ok(()),
            TaskStatus::Running | TaskStatus::Waiting => {
                bail!("运行中或等待子任务的任务请使用取消，无法单独暂停")
            }
        }
    }

    /// 将 paused 任务恢复为 pending。
    pub async fn resume_task(&self, task_id: i64) -> anyhow::Result<()> {
        let store = self.scheduler.store();
        let task = store
            .task_by_id(task_id)
            .await
            .context("查询任务失败")?
            .ok_or_else(|| anyhow::anyhow!("任务不存在或已结束"))?;

        if task.status != TaskStatus::Paused {
            bail!("仅 paused 状态的任务可恢复，当前状态为 {:?}", task.status);
        }

        store.resume(task_id).await.context("恢复任务失败")?;
        Ok(())
    }

    /// 删除一条任务历史记录。
    pub async fn delete_history(&self, history_id: i64) -> anyhow::Result<bool> {
        self.scheduler
            .store()
            .delete_history(history_id)
            .await
            .context("删除历史记录失败")
    }

    /// 列出活跃队列中的任务（pending / running / paused / waiting / blocked）。
    pub async fn list_active_tasks(&self, limit: i32) -> anyhow::Result<Vec<TaskRecord>> {
        let limit = limit.clamp(1, 500) as usize;
        let mut tasks = self
            .scheduler
            .store()
            .all_active_tasks()
            .await
            .context("读取活跃任务失败")?;
        tasks.truncate(limit);
        Ok(tasks)
    }
}
