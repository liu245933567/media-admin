/**
 * Taskmill 调度器快照相关的 TypeScript 类型，与后端 JSON 一一对应。
 *
 * - 后端结构：`ma_service::job::TaskmillSnapshot`（`crates/service/src/job/storage.rs`）
 * - 内含：`scheduler: SchedulerSnapshot`、`metrics: MetricsSnapshot`（crate **taskmill 0.7.1**）
 * - 日期时间：chrono `DateTime<Utc>` → ISO 8601 字符串
 * - 时长：`std::time::Duration` → serde 默认结构 `{ secs, nanos }`
 *
 * 说明：此处为手写对齐（非 typeshare）；若升级 taskmill 大版本，请对照 crate 中同名 struct 校验字段。
 */

/**
 * serde 对 `std::time::Duration` 的默认序列化形态（秒 + 纳秒余量）。
 */
export interface TaskmillSerdeDuration {
  /** 整秒 */
  secs: number
  /** 纳秒余量（0～999_999_999） */
  nanos: number
}

/**
 * 活跃队列中的任务生命周期状态（非历史终态）。
 *
 * - `pending`：等待派发
 * - `running`：正在执行
 * - `paused`：被抢占或策略暂停
 * - `waiting`：父任务 execute 已返回，子任务仍在跑
 * - `blocked`：依赖未全部成功完成，尚不可派发
 *
 * @see taskmill `TaskStatus`
 */
export type TaskmillTaskStatus
  = | 'pending'
    | 'running'
    | 'paused'
    | 'waiting'
    | 'blocked'

/**
 * TTL 从何时开始计时。
 * - `submission`：入队即算过期时间
 * - `first_attempt`：首次开始执行后才起算
 */
export type TaskmillTtlFrom = 'submission' | 'first_attempt'

/**
 * 某个依赖任务失败时，对本任务的处置策略。
 * - `cancel`：自动取消（默认）
 * - `fail`：记为依赖失败，便于人工介入
 * - `ignore`：仍解除阻塞（慎用）
 */
export type TaskmillDependencyFailurePolicy = 'cancel' | 'fail' | 'ignore'

/**
 * 数值优先级：`0` 最高、`255` 最低（taskmill `Priority`，serde 透明包装为 `u8` → JSON 数字）。
 */
export type TaskmillPriority = number

/** 任务声明或统计用的磁盘 / 网络 IO 预算（字节）。 */
export interface TaskmillIoBudget {
  disk_read: number
  disk_write: number
  net_rx: number
  net_tx: number
}

/**
 * 活跃表中的一条任务记录（待运行、运行中、暂停等）。
 * @see taskmill `TaskRecord`
 */
export interface TaskmillTaskRecord {
  /** 数据库主键 */
  id: number
  /** 任务类型标识（可含 `module::name` 前缀） */
  task_type: string
  /** 去重用的 SHA-256 等稳定键 */
  key: string
  /** 展示用标签（无显式 key 时常与 task_type 同源） */
  label: string
  /** 存储优先级（数值越小越优先） */
  priority: TaskmillPriority
  status: TaskmillTaskStatus
  /**
   * 序列化后的任务载荷；Rust 侧为 `Vec<u8>`，JSON 中为数字数组（通常为 UTF-8 JSON 字节）。
   */
  payload: number[] | null
  /** 入队时声明的 IO 预算，供调度参考 */
  expected_io: TaskmillIoBudget
  /** 已重试次数 */
  retry_count: number
  /** 最近一次错误信息（运行中失败时） */
  last_error: string | null
  /** 创建时间（UTC，RFC3339） */
  created_at: string
  /** 首次开始执行时间 */
  started_at: string | null
  /** 是否要求在完成后重新入队 */
  requeue: boolean
  /** 若 requeue，使用的优先级覆盖 */
  requeue_priority: TaskmillPriority | null
  /** 父任务 id；顶层为 `null` */
  parent_id: number | null
  /**
   * 子任务任一失败是否立即失败父任务；
   * 为 `false` 时父任务会等所有子任务结束再收尾。
   */
  fail_fast: boolean
  /** 分组并发键（同组共享并发预算） */
  group_key: string | null
  /** TTL 秒数；`null` 表示无 TTL */
  ttl_seconds: number | null
  ttl_from: TaskmillTtlFrom
  /** 预计算的过期时刻 */
  expires_at: string | null
  /** 延迟派发：在此之前保持 pending 但不可派发 */
  run_after: string | null
  /** 定时间隔（秒）；`null` 为非周期任务 */
  recurring_interval_secs: number | null
  /** 周期任务最大执行次数 */
  recurring_max_executions: number | null
  /** 已完成的周期执行次数 */
  recurring_execution_count: number
  /** 周期调度是否暂停（不再生成新实例） */
  recurring_paused: boolean
  /** 依赖的任务 id 列表 */
  dependencies: number[]
  on_dependency_failure: TaskmillDependencyFailurePolicy
  /** 业务自定义键值标签 */
  tags: Record<string, string>
  /** 本任务最大重试次数；`null` 表示沿用全局默认 */
  max_retries: number | null
  /**
   * `execute` 阶段写入的 memo 序列化字节；JSON 为数字数组。
   */
  memo: number[] | null
  /** 暂停原因位掩码（SQLite INTEGER）；0 表示未暂停 */
  pause_reasons: number
  /** 累计处于 paused 的毫秒数（不参与 aging 计时） */
  pause_duration_ms: number
  /** 最近一次进入暂停的 epoch 毫秒时间戳 */
  paused_at_ms: number | null
}

/**
 * 调度事件 / 进度条目中的公共头字段。
 * `module` 为从 `task_type` 中 `::` 前缀解析出的模块名，无前缀时为空串。
 */
export interface TaskmillTaskEventHeader {
  task_id: number
  task_type: string
  module: string
  key: string
  label: string
  tags: Record<string, string>
  /** 入队时写入的基准优先级 */
  base_priority: TaskmillPriority
  /** 派发时刻结合 aging 计算后的有效优先级 */
  effective_priority: TaskmillPriority
}

/**
 * 对运行中任务的进度估计：合并执行器上报与吞吐外推。
 * `percent` 为当前最佳估计，范围约 0～1。
 */
export interface TaskmillEstimatedProgress {
  header: TaskmillTaskEventHeader
  /** 执行器上报的完成比例（0～1），可能为 `null` */
  reported_percent: number | null
  /** 基于历史耗时的外推比例（0～1），可能为 `null` */
  extrapolated_percent: number | null
  /** 综合后的完成比例（0～1） */
  percent: number
}

/**
 * 字节级进度采样（与 progress ticker 通道一致）。
 * `throughput_bps` 为平滑后的字节每秒；`elapsed` / `eta` 为 `Duration` 结构。
 */
export interface TaskmillTaskProgress {
  task_id: number
  task_type: string
  key: string
  label: string
  bytes_completed: number
  bytes_total: number | null
  /** 平滑后的吞吐，单位：字节/秒 */
  throughput_bps: number
  /** 自任务开始执行起累计时长 */
  elapsed: TaskmillSerdeDuration
  /** 根据吞吐与剩余字节估算的剩余时间；未知为 `null` */
  eta: TaskmillSerdeDuration | null
}

/** 当前被暂停的分组及恢复信息。 */
export interface TaskmillPausedGroupInfo {
  group: string
  paused_at: string
  paused_task_count: number
  /** 定时自动恢复时刻；非限时暂停为 `null` */
  resume_at: string | null
}

/** 活跃周期调度的一条摘要。 */
export interface TaskmillRecurringScheduleInfo {
  task_id: number
  task_type: string
  label: string
  interval_secs: number
  next_run: string | null
  execution_count: number
  max_executions: number | null
  paused: boolean
}

/** 某条速率限制规则及其令牌桶瞬时状态。 */
export interface TaskmillRateLimitInfo {
  /** 作用域 id，如 `type:media::upload` */
  scope: string
  /** 作用域种类：`type` 或 `group` 等 */
  scope_kind: string
  /** 每个时间窗口内允许的许可数 */
  permits: number
  /** 窗口长度（毫秒） */
  interval_ms: number
  /** 突发容量 */
  burst: number
  /** 当前桶内可用令牌（浮点便于观测） */
  available_tokens: number
}

/**
 * 优先级老化（防饿死）配置。
 * 等待超过 `grace_period` 后，每隔 `aging_interval` 提升一级有效优先级，但不低于 `max_effective_priority` 数值边界。
 */
export interface TaskmillAgingConfig {
  grace_period: TaskmillSerdeDuration
  aging_interval: TaskmillSerdeDuration
  /** 老化可达的最高优先级（数值上界，数值越小表示优先级越高） */
  max_effective_priority: TaskmillPriority
  /** 达到该有效优先级后可走全局池等“紧急”路径；`null` 关闭 */
  urgent_threshold: TaskmillPriority | null
}

/** 公平调度下各分组的槽位分配快照。 */
export interface TaskmillGroupAllocationInfo {
  group: string
  weight: number
  allocated_slots: number
  running: number
  pending: number
  min_slots: number | null
  cap: number | null
}

/**
 * 调度器单帧状态快照，适合仪表盘一次拉取。
 * @see taskmill `SchedulerSnapshot`
 */
export interface TaskmillSchedulerSnapshot {
  /** 当前正在执行的任务列表 */
  running: TaskmillTaskRecord[]
  /** 等待派发的任务数量 */
  pending_count: number
  /** 被暂停的任务数量 */
  paused_count: number
  /** 父任务等待子任务的数量 */
  waiting_count: number
  /** 各运行任务的进度估计 */
  progress: TaskmillEstimatedProgress[]
  /** 综合背压，约 0～1 */
  pressure: number
  /** 按来源拆分的背压，元组为 `[来源名, 0～1]` */
  pressure_breakdown: [string, number][]
  /** 当前全局最大并发 */
  max_concurrency: number
  /** 字节进度 ticker 采样的快照 */
  byte_progress: TaskmillTaskProgress[]
  /** 调度器是否全局暂停 */
  is_paused: boolean
  recurring_schedules: TaskmillRecurringScheduleInfo[]
  /** 因依赖未满足而阻塞的任务数 */
  blocked_count: number
  paused_groups: TaskmillPausedGroupInfo[]
  rate_limits: TaskmillRateLimitInfo[]
  /** 未启用老化时为 `null` */
  aging_config: TaskmillAgingConfig | null
  /** 未配置公平时通常为空数组 */
  group_allocations: TaskmillGroupAllocationInfo[]
}

/**
 * 自调度器创建以来的累计计数器 + 当前瞬时 gauge。
 * 计数器单调递增；gauge 反映读取瞬间状态。
 * @see taskmill `MetricsSnapshot`
 */
export interface TaskmillMetricsSnapshot {
  // —— 计数器（累计）——
  /** 入队提交次数 */
  submitted: number
  /** 实际开始执行次数 */
  dispatched: number
  /** 成功完成次数 */
  completed: number
  /** 失败次数（含不可重试） */
  failed: number
  /** 失败但可重试的次数 */
  failed_retryable: number
  /** 发生重试的次数 */
  retried: number
  /** 重试耗尽进入死信 */
  dead_lettered: number
  /** 被同 key 新任务取代 */
  superseded: number
  /** 主动取消 */
  cancelled: number
  /** TTL 等到期 */
  expired: number
  /** 被高优先级抢占 */
  preempted: number
  /** 批量提交 API 调用次数 */
  batches_submitted: number
  /** 并发门闸拒绝 */
  gate_denials: number
  /** 触发速率限制而暂缓 */
  rate_limit_throttles: number
  /** 分组被暂停次数（累计） */
  group_pauses: number
  /** 分组恢复次数（累计） */
  group_resumes: number
  /** 依赖失败导致连锁取消等 */
  dependency_failures: number
  /** 周期任务因策略跳过 */
  recurring_skipped: number
  // —— 仪表盘（瞬时）——
  /** 当前待派发任务数 */
  pending: number
  /** 当前正在执行任务数 */
  running: number
  /** 因依赖未满足而阻塞的任务数 */
  blocked: number
  /** 处于 paused 状态的任务数 */
  paused: number
  /** 父任务等待子任务的数量 */
  waiting: number
  /** 当前综合背压 */
  pressure: number
  /** 当前配置的最大并发 */
  max_concurrency: number
  /** 处于暂停状态的分组数量 */
  groups_paused: number
}

/**
 * `/api/jobs/snapshot` 返回体：调度器视图 + 指标视图。
 */
export interface TaskmillJobSnapshot {
  scheduler: TaskmillSchedulerSnapshot
  metrics: TaskmillMetricsSnapshot
}
