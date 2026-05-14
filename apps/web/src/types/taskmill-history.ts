/**
 * `task_history` 表行对应的 JSON 形态（与 taskmill `TaskHistoryRecord` 对齐，crate 0.7.1）。
 * 由 `GET /api/job-demo/history` 返回 `TaskHistoryRecord[]`。
 */

import type { TaskmillIoBudget, TaskmillPriority, TaskmillTtlFrom } from './taskmill-snapshot'

/**
 * 任务进入历史表时的终态（非活跃队列状态）。
 * @see taskmill `HistoryStatus`
 */
export type TaskmillHistoryStatus
  = | 'completed'
    | 'failed'
    | 'cancelled'
    | 'superseded'
    | 'expired'
    | 'dependency_failed'
    | 'dead_letter'

/** 单条历史记录（终态任务）。 */
export interface TaskmillTaskHistoryRecord {
  id: number
  task_type: string
  key: string
  label: string
  priority: TaskmillPriority
  status: TaskmillHistoryStatus
  /** `Vec<u8>` → JSON 数字数组 */
  payload: number[] | null
  expected_io: TaskmillIoBudget
  /** 执行结束后统计的实际 IO；无数据时为 `null` */
  actual_io: TaskmillIoBudget | null
  retry_count: number
  last_error: string | null
  created_at: string
  started_at: string | null
  completed_at: string
  duration_ms: number | null
  parent_id: number | null
  fail_fast: boolean
  group_key: string | null
  ttl_seconds: number | null
  ttl_from: TaskmillTtlFrom
  expires_at: string | null
  run_after: string | null
  tags: Record<string, string>
  max_retries: number | null
  memo: number[] | null
}
