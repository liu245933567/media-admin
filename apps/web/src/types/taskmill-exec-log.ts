/**
 * `GET /api/job-demo/exec-log` 返回项（与 `TimestampedSchedulerEvent` JSON 对齐）。
 * `event` 为 taskmill `SchedulerEvent` 的 serde 外形（`type` + `data`）。
 */
export interface TaskmillDemoExecLogEntry {
  received_at: string
  event: Record<string, unknown>
}
