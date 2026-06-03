import type {
  TaskmillExecLogEntry,
  TaskmillTaskHistoryRecord,
  TaskmillTaskRecord,
} from '@/api'
import { Button, Card, Chip, Input, Label, Modal, Spinner, Switch, Table } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatTaskmillTime } from '@/lib/taskmill-time'
import { transJobType, transStatus } from './taskmill-active-tasks-panel'

interface TaskEventHeaderLike {
  task_id?: number
  label?: string
  task_type?: string
}

type TaskmillKnownTask = TaskmillTaskRecord | TaskmillTaskHistoryRecord
type PipelineFilter = 'all' | 'running' | 'finished' | 'failed'
type EventTone = 'default' | 'accent' | 'success' | 'warning' | 'danger'

interface TaskEventLine {
  key: string
  type: string
  receivedAt: string
  summary: string
  percent?: number
  tone: EventTone
}

interface TaskLogGroup {
  taskId: number
  taskType: string
  label: string
  parentId: number | null
  status: string
  createdAt: string | null
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  latestAt: string
  percent: number | null
  lines: TaskEventLine[]
}

interface PipelineView {
  root: TaskLogGroup
  jobs: TaskLogGroup[]
  status: string
  latestAt: string
  percent: number | null
}

function readEventHeader(event: Record<string, unknown>): TaskEventHeaderLike | undefined {
  const data = event.data
  if (!data || typeof data !== 'object') {
    return undefined
  }
  const d = data as Record<string, unknown>
  if ('header' in d && d.header && typeof d.header === 'object') {
    return d.header as TaskEventHeaderLike
  }
  if ('task_id' in d) {
    return d as TaskEventHeaderLike
  }
  if ('old' in d && d.old && typeof d.old === 'object') {
    return d.old as TaskEventHeaderLike
  }
  return undefined
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined
}

function readEventTaskId(event: Record<string, unknown>): number | undefined {
  const h = readEventHeader(event)
  if (typeof h?.task_id === 'number') {
    return h.task_id
  }

  const data = asRecord(event.data)
  return typeof data?.task_id === 'number' ? data.task_id : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isHistoryTask(task: TaskmillKnownTask): task is TaskmillTaskHistoryRecord {
  return 'completed_at' in task
}

function taskStatusColor(status: string): EventTone {
  const map: Record<string, EventTone> = {
    running: 'success',
    pending: 'default',
    paused: 'warning',
    waiting: 'accent',
    blocked: 'warning',
    completed: 'success',
    failed: 'danger',
    cancelled: 'default',
    superseded: 'accent',
    expired: 'warning',
    dependency_failed: 'danger',
    dead_letter: 'danger',
  }
  return map[status] ?? 'default'
}

function eventTone(type: string): EventTone {
  const map: Record<string, EventTone> = {
    Dispatched: 'accent',
    Progress: 'accent',
    Waiting: 'warning',
    Completed: 'success',
    Failed: 'danger',
    Cancelled: 'default',
    DeadLettered: 'danger',
    DependencyFailed: 'danger',
    TaskExpired: 'warning',
    TaskUnblocked: 'accent',
    Preempted: 'warning',
    Superseded: 'warning',
  }
  return map[type] ?? 'default'
}

function statusIcon(status: string): string {
  const map: Record<string, string> = {
    running: 'lucide:loader-circle',
    pending: 'lucide:clock',
    paused: 'lucide:pause',
    waiting: 'lucide:hourglass',
    blocked: 'lucide:ban',
    completed: 'lucide:check',
    failed: 'lucide:x',
    cancelled: 'lucide:circle-slash',
    superseded: 'lucide:replace',
    expired: 'lucide:clock-alert',
    dependency_failed: 'lucide:git-branch-plus',
    dead_letter: 'lucide:triangle-alert',
  }
  return map[status] ?? 'lucide:dot'
}

function eventLabel(type: string): string {
  const map: Record<string, string> = {
    Dispatched: '开始',
    Progress: '进度',
    Waiting: '等待子任务',
    Completed: '完成',
    Failed: '失败',
    Preempted: '抢占',
    Cancelled: '取消',
    DeadLettered: '死信',
    Superseded: '替换',
    TaskExpired: '过期',
    TaskUnblocked: '解除阻塞',
    DependencyFailed: '依赖失败',
    BatchSubmitted: '批量提交',
    Paused: '暂停调度',
    Resumed: '恢复调度',
  }
  return map[type] ?? type
}

function formatPercent(percent: number): string {
  return `${Math.round(percent * 1000) / 10}%`
}

function formatDurationMs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value) || value < 0) {
    return '-'
  }

  const totalSeconds = Math.max(1, Math.ceil(value / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes <= 0) {
    return `${seconds}s`
  }
  return `${minutes}m ${seconds}s`
}

function durationBetween(start: string | null, end: string | null): number | null {
  if (!start || !end) {
    return null
  }
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) {
    return null
  }
  return e - s
}

function latestLineOf(task: TaskLogGroup): TaskEventLine | undefined {
  return task.lines.at(-1)
}

function pipelineTitle(pipeline: PipelineView): string {
  return pipeline.root.label || transJobType(pipeline.root.taskType) || `任务 #${pipeline.root.taskId}`
}

function stageName(task: TaskLogGroup): string {
  const label = transJobType(task.taskType)
  if (label) {
    return label
  }
  return task.label || `任务 #${task.taskId}`
}

/** 将 taskmill `SchedulerEvent` JSON 压缩为一行可读摘要 */
export function formatTaskmillExecLogSummary(event: Record<string, unknown>): string {
  const typeStr = typeof event.type === 'string' ? event.type : '?'
  const h = readEventHeader(event)
  const who = h
    ? `[#${h.task_id ?? '?'} ${(h.label || h.task_type || '').trim()}] `
    : ''

  switch (typeStr) {
    case 'Progress': {
      const data = event.data as Record<string, unknown> | undefined
      const pct = typeof data?.percent === 'number'
        ? formatPercent(data.percent)
        : ''
      const msg = typeof data?.message === 'string' ? data.message : ''
      return `${who}${pct} ${msg}`.trim()
    }
    case 'Dispatched':
      return `${who}已派发`.trim()
    case 'Completed':
      return `${who}已完成`.trim()
    case 'Failed': {
      const data = event.data as Record<string, unknown> | undefined
      const err = typeof data?.error === 'string' ? data.error : ''
      const retry = data?.will_retry === true ? '（将重试）' : ''
      return `${who}失败${retry}: ${err}`.trim()
    }
    case 'Preempted':
      return `${who}被抢占`.trim()
    case 'Cancelled':
      return `${who}已取消`.trim()
    case 'Waiting': {
      const data = event.data as Record<string, unknown> | undefined
      return `[#${String(data?.task_id ?? '?')}] 等待 ${String(data?.children_count ?? '?')} 个子任务完成`
    }
    case 'TaskUnblocked': {
      const data = event.data as Record<string, unknown> | undefined
      return `[#${String(data?.task_id ?? '?')}] 依赖已满足，重新进入等待执行`
    }
    case 'DependencyFailed': {
      const data = event.data as Record<string, unknown> | undefined
      return `[#${String(data?.task_id ?? '?')}] 依赖任务 #${String(data?.failed_dependency ?? '?')} 失败`
    }
    case 'TaskExpired':
      return `${who}已过期`.trim()
    case 'DeadLettered': {
      const data = event.data as Record<string, unknown> | undefined
      const err = typeof data?.error === 'string' ? data.error : ''
      return `${who}死信: ${err}`.trim()
    }
    case 'Superseded': {
      const data = event.data as Record<string, unknown> | undefined
      const nid = data?.new_task_id
      return `${who}被取代 -> 新任务 #${nid ?? '?'}`.trim()
    }
    case 'BatchSubmitted': {
      const data = event.data as Record<string, unknown> | undefined
      const c = data?.count
      return `批量提交: ${String(c ?? '?')} 条`.trim()
    }
    case 'Paused':
      return '调度器：全局暂停'
    case 'Resumed':
      return '调度器：恢复运行'
    default:
      return typeStr
  }
}

function formatProcessEventSummary(event: Record<string, unknown>): { summary: string, percent?: number } {
  const typeStr = typeof event.type === 'string' ? event.type : '?'
  const data = asRecord(event.data)

  switch (typeStr) {
    case 'Progress': {
      const percent = readNumber(data?.percent)
      const message = readString(data?.message)
      return {
        percent,
        summary: [percent == null ? undefined : formatPercent(percent), message]
          .filter(Boolean)
          .join(' '),
      }
    }
    case 'Dispatched':
      return { summary: '开始执行' }
    case 'Completed':
      return { summary: '执行完成', percent: 1 }
    case 'Failed': {
      const retry = data?.will_retry === true ? '，稍后自动重试' : ''
      return { summary: `执行失败${retry}: ${readString(data?.error) ?? '未知错误'}` }
    }
    case 'Waiting':
      return { summary: `等待 ${String(data?.children_count ?? '?')} 个子任务完成` }
    case 'TaskUnblocked':
      return { summary: '依赖已满足，重新进入等待执行' }
    case 'DependencyFailed':
      return { summary: `依赖任务 #${String(data?.failed_dependency ?? '?')} 失败` }
    case 'Cancelled':
      return { summary: '任务已取消' }
    case 'DeadLettered':
      return { summary: `重试耗尽，进入死信: ${readString(data?.error) ?? '未知错误'}` }
    case 'TaskExpired':
      return { summary: '任务已过期' }
    case 'Preempted':
      return { summary: '被更高优先级任务抢占' }
    case 'Superseded':
      return { summary: `被新任务 #${String(data?.new_task_id ?? '?')} 替换` }
    default:
      return { summary: formatTaskmillExecLogSummary(event) }
  }
}

function deriveStatusFromEvent(type: string, event: Record<string, unknown>, current: string): string {
  switch (type) {
    case 'Dispatched':
    case 'Progress':
      return current === 'completed' ? current : 'running'
    case 'Waiting':
      return 'waiting'
    case 'Completed':
      return 'completed'
    case 'Failed': {
      const data = asRecord(event.data)
      return data?.will_retry === true ? 'pending' : 'failed'
    }
    case 'Cancelled':
      return 'cancelled'
    case 'DeadLettered':
      return 'dead_letter'
    case 'TaskExpired':
      return 'expired'
    case 'DependencyFailed':
      return 'dependency_failed'
    case 'Preempted':
      return 'paused'
    default:
      return current
  }
}

function mergeTask(
  task: TaskmillKnownTask,
  existing?: TaskLogGroup,
): TaskLogGroup {
  const completedAt = isHistoryTask(task) ? task.completed_at : null
  return {
    taskId: task.id,
    taskType: task.task_type,
    label: task.label,
    parentId: task.parent_id,
    status: task.status,
    createdAt: task.created_at,
    startedAt: task.started_at,
    completedAt,
    durationMs: isHistoryTask(task) ? task.duration_ms : null,
    latestAt: completedAt ?? task.started_at ?? task.created_at,
    percent: task.status === 'completed' ? 1 : existing?.percent ?? null,
    lines: existing?.lines ?? [],
  }
}

function buildTaskLogGroups(
  items: TaskmillExecLogEntry[] | undefined,
  activeItems: TaskmillTaskRecord[] | undefined,
  historyItems: TaskmillTaskHistoryRecord[] | undefined,
): TaskLogGroup[] {
  const groups = new Map<number, TaskLogGroup>()

  for (const task of historyItems ?? []) {
    groups.set(task.id, mergeTask(task, groups.get(task.id)))
  }
  for (const task of activeItems ?? []) {
    groups.set(task.id, mergeTask(task, groups.get(task.id)))
  }

  for (const [index, row] of (items ?? []).entries()) {
    const taskId = readEventTaskId(row.event)
    if (taskId == null) {
      continue
    }

    const type = typeof row.event.type === 'string' ? row.event.type : '?'
    const header = readEventHeader(row.event)
    const existing = groups.get(taskId)
    const formatted = formatProcessEventSummary(row.event)
    const status = deriveStatusFromEvent(type, row.event, existing?.status ?? 'pending')
    const percent = formatted.percent ?? existing?.percent ?? null

    const line: TaskEventLine = {
      key: `${row.received_at}-${type}-${index}`,
      type,
      receivedAt: row.received_at,
      summary: formatted.summary || eventLabel(type),
      percent: formatted.percent,
      tone: eventTone(type),
    }

    groups.set(taskId, {
      taskId,
      taskType: existing?.taskType ?? header?.task_type ?? '',
      label: existing?.label ?? header?.label ?? '',
      parentId: existing?.parentId ?? null,
      status,
      createdAt: existing?.createdAt ?? null,
      startedAt: existing?.startedAt ?? null,
      completedAt: existing?.completedAt ?? (type === 'Completed' ? row.received_at : null),
      durationMs: existing?.durationMs ?? null,
      latestAt: row.received_at,
      percent,
      lines: [...(existing?.lines ?? []), line],
    })
  }

  return Array.from(groups.values())
}

function buildPipelineViews(groups: TaskLogGroup[]): PipelineView[] {
  const byId = new Map(groups.map(group => [group.taskId, group]))
  const childrenByParent = new Map<number, TaskLogGroup[]>()

  for (const group of groups) {
    if (group.parentId != null && byId.has(group.parentId)) {
      const children = childrenByParent.get(group.parentId) ?? []
      children.push(group)
      childrenByParent.set(group.parentId, children)
    }
  }

  const readRoot = (group: TaskLogGroup): TaskLogGroup => {
    let current = group
    const seen = new Set<number>()
    while (current.parentId != null && byId.has(current.parentId) && !seen.has(current.parentId)) {
      seen.add(current.taskId)
      current = byId.get(current.parentId)!
    }
    return current
  }

  const roots = new Map<number, TaskLogGroup>()
  for (const group of groups) {
    const root = readRoot(group)
    roots.set(root.taskId, root)
  }

  const collectJobs = (root: TaskLogGroup): TaskLogGroup[] => {
    const jobs: TaskLogGroup[] = []
    const visit = (task: TaskLogGroup) => {
      jobs.push(task)
      const children = [...(childrenByParent.get(task.taskId) ?? [])].sort(
        (a, b) => (a.startedAt ?? a.createdAt ?? a.latestAt).localeCompare(b.startedAt ?? b.createdAt ?? b.latestAt),
      )
      for (const child of children) {
        visit(child)
      }
    }
    visit(root)
    return jobs
  }

  return Array.from(roots.values())
    .map((root) => {
      const jobs = collectJobs(root)
      const latestAt = jobs.reduce(
        (latest, job) => job.latestAt > latest ? job.latestAt : latest,
        root.latestAt,
      )
      const terminal = jobs.find(job =>
        ['failed', 'dead_letter', 'dependency_failed', 'expired'].includes(job.status),
      )
      const status = terminal?.status
        ?? (jobs.every(job => job.status === 'completed') ? 'completed' : root.status)
      const progressValues = jobs.map(job => job.percent).filter((v): v is number => v != null)
      const percent = progressValues.length
        ? progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length
        : null
      return { root, jobs, latestAt, status, percent }
    })
    .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime())
}

function stageJobs(pipeline: PipelineView): TaskLogGroup[] {
  if (pipeline.jobs.length <= 1) {
    return pipeline.jobs
  }
  return pipeline.jobs.filter(job => job.taskId !== pipeline.root.taskId)
}

function matchesFilter(pipeline: PipelineView, filter: PipelineFilter): boolean {
  switch (filter) {
    case 'finished':
      return pipeline.status === 'completed'
    case 'running':
      return ['running', 'waiting', 'pending', 'paused', 'blocked'].includes(pipeline.status)
    case 'failed':
      return ['failed', 'dead_letter', 'dependency_failed', 'expired'].includes(pipeline.status)
    default:
      return true
  }
}

function stageDot(task: TaskLogGroup, selected: boolean) {
  return (
    <span
      className={[
        'flex size-8 items-center justify-center rounded-full border-2',
        selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface' : '',
        taskStatusColor(task.status) === 'success'
          ? 'border-success bg-success/15 text-success'
          : taskStatusColor(task.status) === 'danger'
            ? 'border-danger bg-danger/15 text-danger'
            : taskStatusColor(task.status) === 'warning'
              ? 'border-warning bg-warning/15 text-warning'
              : 'border-border bg-surface-secondary text-muted',
      ].filter(Boolean).join(' ')}
    >
      <Icon className={task.status === 'running' ? 'size-4 animate-spin' : 'size-4'} icon={statusIcon(task.status)} />
    </span>
  )
}

function StatusBlock({ task }: { task: TaskLogGroup }) {
  const duration = task.durationMs ?? durationBetween(task.startedAt, task.completedAt ?? task.latestAt)

  return (
    <div className="flex min-w-28 flex-col items-start gap-1">
      <Chip color={taskStatusColor(task.status)} size="sm" variant="soft">
        <Icon className={task.status === 'running' ? 'size-3.5 animate-spin' : 'size-3.5'} icon={statusIcon(task.status)} />
        {transStatus(task.status)}
      </Chip>
      <div className="flex items-center gap-1 text-xs tabular-nums text-muted">
        <Icon className="size-3.5" icon="lucide:timer" />
        {formatDurationMs(duration)}
      </div>
      <div className="flex items-center gap-1 text-xs text-muted">
        <Icon className="size-3.5" icon="lucide:calendar" />
        {formatTaskmillTime(task.createdAt)}
      </div>
    </div>
  )
}

function PipelineStages({
  jobs,
  selectedJobId,
  onSelect,
  compact,
}: {
  jobs: TaskLogGroup[]
  selectedJobId: number | null
  onSelect: (id: number) => void
  compact?: boolean
}) {
  if (jobs.length === 0) {
    return <span className="text-sm text-muted">暂无子任务</span>
  }

  return (
    <div className="flex min-w-0 items-center overflow-x-auto py-1">
      {jobs.map((job, index) => (
        <div key={job.taskId} className="flex items-center">
          {index > 0 && <span className={compact ? 'h-px w-5 shrink-0 bg-divider' : 'h-px w-10 shrink-0 bg-divider'} />}
          <button
            className="group flex shrink-0 flex-col items-center gap-2 text-left"
            type="button"
            onClick={() => onSelect(job.taskId)}
          >
            {stageDot(job, selectedJobId === job.taskId)}
            {!compact && (
              <span className="max-w-32 truncate text-xs text-muted group-hover:text-foreground" title={stageName(job)}>
                {stageName(job)}
              </span>
            )}
          </button>
        </div>
      ))}
    </div>
  )
}

function JobLogView({
  job,
  autoScroll,
}: {
  job: TaskLogGroup | undefined
  autoScroll: boolean
}) {
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!autoScroll || !logRef.current) {
      return
    }
    logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.lines, autoScroll])

  if (!job) {
    return (
      <div className="rounded-lg border border-border bg-surface-secondary px-4 py-8 text-center text-sm text-muted">
        选择一个 job 后显示日志
      </div>
    )
  }

  const lines = job.lines.length > 0
    ? job.lines
    : [{
        key: `empty-${job.taskId}`,
        type: 'Pending',
        receivedAt: job.latestAt,
        summary: '当前任务还没有调度事件日志',
        tone: 'default' as EventTone,
      }]

  return (
    <Card>
      <Card.Header className="items-center justify-between">
        <div className="min-w-0 flex-1">
          <Card.Title className="truncate" title={job.label || stageName(job)}>
            {job.label || stageName(job)}
          </Card.Title>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <Chip color={taskStatusColor(job.status)} size="sm" variant="soft">
              {transStatus(job.status)}
            </Chip>
            <span>
              任务 #
              {job.taskId}
            </span>
            <span>{transJobType(job.taskType)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button isIconOnly size="sm" variant="tertiary">
            <Icon className="size-4" icon="lucide:file-json" />
          </Button>
          <Button isIconOnly size="sm" variant="tertiary">
            <Icon className="size-4" icon="lucide:download" />
          </Button>
        </div>
      </Card.Header>
      <Card.Content className="p-0">
        <div className="border-y border-border bg-surface-secondary px-4 py-2 text-xs text-muted">
          Log timestamps follow server event receive time.
        </div>
        <div
          ref={logRef}
          className="max-h-[32rem] overflow-auto bg-[#1f1f27] px-4 py-3 font-mono text-[13px] leading-6 text-neutral-100"
        >
          {lines.map((line, index) => (
            <div key={line.key} className="grid grid-cols-[3rem_9rem_minmax(0,1fr)] gap-3">
              <span className="select-none text-right text-neutral-500">{index + 1}</span>
              <span className="select-none text-neutral-400">{formatTaskmillTime(line.receivedAt).slice(11)}</span>
              <span className={line.type === 'Progress' ? 'whitespace-pre-wrap break-words text-cyan-300' : 'whitespace-pre-wrap break-words'}>
                {line.summary}
              </span>
            </div>
          ))}
        </div>
      </Card.Content>
    </Card>
  )
}

export interface TaskmillExecLogPanelProps {
  items: TaskmillExecLogEntry[] | undefined
  activeItems?: TaskmillTaskRecord[]
  historyItems?: TaskmillTaskHistoryRecord[]
  loading?: boolean
}

export function TaskmillExecLogPanel({
  items,
  activeItems,
  historyItems,
  loading,
}: TaskmillExecLogPanelProps) {
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState<PipelineFilter>('all')
  const [q, setQ] = useState('')
  const [detailPipelineId, setDetailPipelineId] = useState<number | null>(null)
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)

  const groups = useMemo(
    () => buildTaskLogGroups(items, activeItems, historyItems),
    [activeItems, historyItems, items],
  )
  const pipelines = useMemo(() => buildPipelineViews(groups), [groups])
  const filteredPipelines = useMemo(() => {
    const keyword = q.trim().toLowerCase()
    return pipelines.filter((pipeline) => {
      if (!matchesFilter(pipeline, filter)) {
        return false
      }
      if (!keyword) {
        return true
      }
      const haystack = [
        pipeline.root.taskId,
        pipeline.root.label,
        pipeline.root.taskType,
        ...pipeline.jobs.flatMap(job => [job.taskId, job.label, job.taskType]),
      ].join(' ').toLowerCase()
      return haystack.includes(keyword)
    })
  }, [filter, pipelines, q])

  const detailPipeline = useMemo(
    () => pipelines.find(pipeline => pipeline.root.taskId === detailPipelineId),
    [detailPipelineId, pipelines],
  )
  const detailStages = detailPipeline ? stageJobs(detailPipeline) : []
  const selectedJob = detailStages.find(job => job.taskId === selectedJobId)
    ?? detailStages[0]
    ?? detailPipeline?.root

  function openPipelineDetail(pipeline: PipelineView, jobId?: number) {
    const stages = stageJobs(pipeline)
    setDetailPipelineId(pipeline.root.taskId)
    setSelectedJobId(jobId ?? (stages[0] ?? pipeline.root).taskId)
  }

  const filterCounts: Record<PipelineFilter, number> = {
    all: pipelines.length,
    running: pipelines.filter(pipeline => matchesFilter(pipeline, 'running')).length,
    finished: pipelines.filter(pipeline => matchesFilter(pipeline, 'finished')).length,
    failed: pipelines.filter(pipeline => matchesFilter(pipeline, 'failed')).length,
  }
  const filterTabs: { key: PipelineFilter, label: string }[] = [
    { key: 'all', label: '全部' },
    { key: 'running', label: '运行中' },
    { key: 'finished', label: '已完成' },
    { key: 'failed', label: '失败' },
  ]

  return (
    <>
      <div className="flex w-full flex-col gap-4">
        <Card>
          <Card.Content className="flex flex-col gap-3 p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-1">
                {filterTabs.map(tab => (
                  <Button
                    key={tab.key}
                    size="sm"
                    variant={filter === tab.key ? 'primary' : 'tertiary'}
                    onPress={() => setFilter(tab.key)}
                  >
                    {tab.label}
                    <Chip size="sm" variant="soft">
                      {filterCounts[tab.key]}
                    </Chip>
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <p className="m-0 hidden text-xs text-muted md:block">
                  最近事件构建，服务端当前保留约 400 条
                </p>
                <Switch isSelected={autoScroll} onChange={setAutoScroll}>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Switch.Content>
                    <Label className="text-sm">日志滚底</Label>
                  </Switch.Content>
                </Switch>
              </div>
            </div>
            <div className="relative">
              <Icon className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted" icon="lucide:search" />
              <Input
                className="pl-9"
                value={q}
                placeholder="Filter pipelines"
                variant="secondary"
                onChange={event => setQ(event.target.value)}
              />
            </div>
          </Card.Content>
        </Card>

        <Table variant="secondary">
          <Table.ScrollContainer className="max-h-[calc(100dvh-18rem)]">
            <Table.Content aria-label="任务执行过程 Pipeline 列表" style={{ minWidth: 980 }}>
              <Table.Header>
                <Table.Column className="w-44">Status</Table.Column>
                <Table.Column isRowHeader>Pipeline</Table.Column>
                <Table.Column className="w-56">Stages</Table.Column>
                <Table.Column className="w-56">Latest</Table.Column>
                <Table.Column className="w-20 text-right">Actions</Table.Column>
              </Table.Header>
              <Table.Body>
                {loading && filteredPipelines.length === 0
                  ? (
                      <Table.Row>
                        <Table.Cell colSpan={5}>
                          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted">
                            <Spinner size="sm" />
                            加载中
                          </div>
                        </Table.Cell>
                      </Table.Row>
                    )
                  : filteredPipelines.length === 0
                    ? (
                        <Table.Row>
                          <Table.Cell colSpan={5}>
                            <div className="py-10 text-center text-sm text-muted">
                              暂无 pipeline；提交任务并恢复调度后会显示执行过程。
                            </div>
                          </Table.Cell>
                        </Table.Row>
                      )
                    : filteredPipelines.map((pipeline) => {
                        const stages = stageJobs(pipeline)
                        const title = pipelineTitle(pipeline)
                        return (
                          <Table.Row
                            key={pipeline.root.taskId}
                            id={String(pipeline.root.taskId)}
                          >
                            <Table.Cell className="align-top">
                              <StatusBlock task={{ ...pipeline.root, status: pipeline.status, percent: pipeline.percent }} />
                            </Table.Cell>
                            <Table.Cell className="min-w-0 align-top">
                              <button
                                className="block max-w-full truncate text-left text-sm font-medium text-accent hover:underline"
                                title={title}
                                type="button"
                                onClick={() => openPipelineDetail(pipeline)}
                              >
                                {title}
                              </button>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                                <span className="font-mono">
                                  #
                                  {pipeline.root.taskId}
                                </span>
                                <Chip size="sm" variant="soft">
                                  {transJobType(pipeline.root.taskType)}
                                </Chip>
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <Chip color="success" size="sm" variant="soft">taskmill</Chip>
                                <Chip color="accent" size="sm" variant="soft">
                                  {pipeline.jobs.length}
                                  {' '}
                                  jobs
                                </Chip>
                                {pipeline.percent != null && (
                                  <Chip color="accent" size="sm" variant="soft">
                                    {formatPercent(pipeline.percent)}
                                  </Chip>
                                )}
                              </div>
                            </Table.Cell>
                            <Table.Cell className="align-top">
                              <PipelineStages
                                compact
                                jobs={stages}
                                selectedJobId={null}
                                onSelect={id => openPipelineDetail(pipeline, id)}
                              />
                            </Table.Cell>
                            <Table.Cell className="min-w-0 align-top text-sm text-muted">
                              <div>{formatTaskmillTime(pipeline.latestAt)}</div>
                              <div className="mt-1 truncate" title={latestLineOf(pipeline.root)?.summary}>
                                {latestLineOf(pipeline.root)?.summary ?? '暂无事件'}
                              </div>
                            </Table.Cell>
                            <Table.Cell className="align-top">
                              <div className="flex justify-end">
                                <Button
                                  isIconOnly
                                  size="sm"
                                  variant="tertiary"
                                  onPress={() => openPipelineDetail(pipeline)}
                                >
                                  <Icon className="size-4" icon="lucide:panel-right-open" />
                                </Button>
                              </div>
                            </Table.Cell>
                          </Table.Row>
                        )
                      })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>

      <Modal.Backdrop
        isOpen={Boolean(detailPipeline)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailPipelineId(null)
            setSelectedJobId(null)
          }
        }}
      >
        <Modal.Container size="lg" className="max-w-[min(1120px,calc(100vw-2rem))]">
          <Modal.Dialog>
            <Modal.Header className="items-start justify-between">
              <div className="min-w-0">
                <Modal.Heading>
                  <span className="block truncate" title={detailPipeline ? pipelineTitle(detailPipeline) : undefined}>
                    {detailPipeline ? pipelineTitle(detailPipeline) : 'Pipeline'}
                  </span>
                </Modal.Heading>
                {detailPipeline && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
                    <Chip color={taskStatusColor(detailPipeline.status)} size="sm" variant="soft">
                      <Icon className={detailPipeline.status === 'running' ? 'size-3.5 animate-spin' : 'size-3.5'} icon={statusIcon(detailPipeline.status)} />
                      {transStatus(detailPipeline.status)}
                    </Chip>
                    <span>
                      Pipeline #
                      {detailPipeline.root.taskId}
                    </span>
                    <span>
                      {detailPipeline.jobs.length}
                      {' '}
                      jobs
                    </span>
                    {detailPipeline.percent != null && <span>{formatPercent(detailPipeline.percent)}</span>}
                  </div>
                )}
              </div>
              <Button
                isIconOnly
                size="sm"
                variant="tertiary"
                onPress={() => {
                  setDetailPipelineId(null)
                  setSelectedJobId(null)
                }}
              >
                <Icon className="size-4" icon="lucide:x" />
              </Button>
            </Modal.Header>
            <Modal.Body className="max-h-[calc(100dvh-10rem)] overflow-auto">
              {detailPipeline && (
                <div className="flex flex-col gap-4">
                  <div className="overflow-x-auto rounded-lg border border-border bg-surface px-4 py-6">
                    <PipelineStages
                      jobs={detailStages}
                      selectedJobId={selectedJob?.taskId ?? null}
                      onSelect={setSelectedJobId}
                    />
                  </div>
                  <JobLogView job={selectedJob} autoScroll={autoScroll} />
                </div>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  )
}
