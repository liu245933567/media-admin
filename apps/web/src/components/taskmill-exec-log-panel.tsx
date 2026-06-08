import type {
  TaskmillExecLogEntry,
  TaskmillTaskHistoryRecord,
  TaskmillTaskRecord,
} from '@/api'
import { ListView } from '@heroui-pro/react/list-view'
import { Button, Card, Chip, Drawer, Dropdown, Input, Label, ListBox, Pagination, Select, Spinner, Switch } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { transJobType, transStatus } from '@/components/taskmill-active-tasks-panel'
import { TaskmillQueueControls } from '@/components/taskmill-queue-controls'
import { formatTaskmillTime } from '@/lib/taskmill-time'

const PIPELINE_PAGE_SIZE_OPTIONS = [10, 20, 50] as const

interface TaskEventHeaderLike {
  task_id?: number
  label?: string
  task_type?: string
}

type TaskmillKnownTask = TaskmillTaskRecord | TaskmillTaskHistoryRecord
type PipelineFilter = 'all' | 'running' | 'finished' | 'failed'
type EventTone = 'default' | 'accent' | 'success' | 'warning' | 'danger'
type PipelinePageItem = number | 'left-ellipsis' | 'right-ellipsis'

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
function formatTaskmillExecLogSummary(event: Record<string, unknown>): string {
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

function paginationItems(page: number, totalPages: number): PipelinePageItem[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1)
  }

  const pages: PipelinePageItem[] = [1]
  if (page > 3) {
    pages.push('left-ellipsis')
  }

  const start = Math.max(2, page - 1)
  const end = Math.min(totalPages - 1, page + 1)
  for (let current = start; current <= end; current += 1) {
    pages.push(current)
  }

  if (page < totalPages - 2) {
    pages.push('right-ellipsis')
  }
  pages.push(totalPages)

  return pages
}

function stageDot(task: TaskLogGroup, selected: boolean) {
  return (
    <span
      className={[
        'flex size-7 items-center justify-center rounded-full border-2',
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
      <Icon className={task.status === 'running' ? 'size-3.5 animate-spin' : 'size-3.5'} icon={statusIcon(task.status)} />
    </span>
  )
}

function StatusChip({ task }: { task: TaskLogGroup }) {
  return (
    <Chip color={taskStatusColor(task.status)} size="sm" variant="soft">
      <Icon className={task.status === 'running' ? 'size-3.5 animate-spin' : 'size-3.5'} icon={statusIcon(task.status)} />
      {transStatus(task.status)}
    </Chip>
  )
}

function TaskDurationMeta({ task }: { task: TaskLogGroup }) {
  const duration = task.durationMs ?? durationBetween(task.startedAt, task.completedAt ?? task.latestAt)

  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Icon className="size-3.5" icon="lucide:timer" />
      {formatDurationMs(duration)}
    </span>
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
    <div className="flex min-w-0 items-center overflow-x-auto py-0.5">
      {jobs.map((job, index) => (
        <div key={job.taskId} className="flex items-center">
          {index > 0 && <span className={compact ? 'h-px w-4 shrink-0 bg-divider' : 'h-px w-8 shrink-0 bg-divider'} />}
          <button
            className="group flex shrink-0 flex-col items-center gap-1.5 text-left"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onSelect(job.taskId)
            }}
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
      <div className="flex h-full min-h-32 items-center justify-center px-4 py-8 text-center text-sm text-muted">
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-3 px-3 pb-2">
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-sm font-medium" title={job.label || stageName(job)}>
            {job.label || stageName(job)}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <StatusChip task={job} />
            <span className="font-mono tabular-nums">
              #
              {job.taskId}
            </span>
            <span className="max-w-48 truncate">{transJobType(job.taskType)}</span>
            <TaskDurationMeta task={job} />
          </div>
        </div>
      </div>
      <div
        ref={logRef}
        className="min-h-0 flex-1 overflow-auto bg-[#1f1f27] px-3 py-2.5 font-mono text-[13px] leading-6 text-neutral-100"
      >
        {lines.map((line, index) => (
          <div key={line.key} className="grid grid-cols-[2.5rem_5rem_minmax(0,1fr)] gap-2">
            <span className="select-none text-right text-neutral-500">{index + 1}</span>
            <span className="select-none text-neutral-400">{formatTaskmillTime(line.receivedAt).slice(11, 19)}</span>
            <span className={line.type === 'Progress' ? 'whitespace-pre-wrap wrap-break-word text-cyan-300' : 'whitespace-pre-wrap wrap-break-word'}>
              {line.summary}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface TaskmillExecLogPanelProps {
  items: TaskmillExecLogEntry[] | undefined
  activeItems?: TaskmillTaskRecord[]
  historyItems?: TaskmillTaskHistoryRecord[]
  loading?: boolean
  runningCount: number
  pendingCount: number
  activeCount: number
  completedCount: number
  failedCount: number
  isSchedulerPaused: boolean
  execLogAutoRefresh: boolean
  onExecLogAutoRefreshChange: (selected: boolean) => void
  onQueueChanged: () => void
  onCreateSubtitle: () => void
  onScanGenerate: () => void
  onTranslate: () => void
}

export function TaskmillExecLogPanel({
  items,
  activeItems,
  historyItems,
  loading,
  runningCount,
  pendingCount,
  activeCount,
  completedCount,
  failedCount,
  isSchedulerPaused,
  execLogAutoRefresh,
  onExecLogAutoRefreshChange,
  onQueueChanged,
  onCreateSubtitle,
  onScanGenerate,
  onTranslate,
}: TaskmillExecLogPanelProps) {
  const [autoScroll, setAutoScroll] = useState(true)
  const [filter, setFilter] = useState<PipelineFilter>('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PIPELINE_PAGE_SIZE_OPTIONS[0])
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
  const totalPipelines = filteredPipelines.length
  const totalPages = Math.max(1, Math.ceil(totalPipelines / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageItems = useMemo(
    () => paginationItems(currentPage, totalPages),
    [currentPage, totalPages],
  )
  const pagedPipelines = useMemo(
    () => filteredPipelines.slice((currentPage - 1) * pageSize, currentPage * pageSize),
    [currentPage, filteredPipelines, pageSize],
  )
  const pageStart = totalPipelines === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const pageEnd = Math.min(currentPage * pageSize, totalPipelines)

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
      <div className="flex w-full flex-col gap-3">
        <Card>
          <Card.Content className="flex flex-col gap-2 p-3">
            <div className="grid gap-2 xl:grid-cols-[minmax(18rem,1fr)_auto] xl:items-center">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 className="m-0 text-base font-semibold">执行过程</h2>
                <div className="flex flex-wrap items-center gap-1">
                  <Chip color={runningCount > 0 ? 'accent' : 'default'} size="sm" variant="soft">
                    执行中
                    {runningCount}
                  </Chip>
                  <Chip color={pendingCount > 0 ? 'warning' : 'default'} size="sm" variant="soft">
                    排队
                    {pendingCount}
                  </Chip>
                  <Chip color={activeCount > 0 ? 'accent' : 'default'} size="sm" variant="soft">
                    活跃
                    {activeCount}
                  </Chip>
                  <Chip color={completedCount > 0 ? 'success' : 'default'} size="sm" variant="soft">
                    完成
                    {completedCount}
                  </Chip>
                  <Chip color={failedCount > 0 ? 'danger' : 'default'} size="sm" variant="soft">
                    失败
                    {failedCount}
                  </Chip>
                  {isSchedulerPaused ? <Chip color="danger" size="sm" variant="soft">调度暂停</Chip> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                <TaskmillQueueControls onChanged={onQueueChanged} />
                <Dropdown>
                  <Button aria-label="新建任务" size="sm" variant="secondary">
                    <Icon className="size-4" icon="lucide:plus" />
                    新建任务
                    <Icon className="size-4" icon="lucide:chevron-down" />
                  </Button>
                  <Dropdown.Popover>
                    <Dropdown.Menu
                      onAction={(key) => {
                        if (key === 'subtitle') {
                          onCreateSubtitle()
                        }
                        else if (key === 'scan') {
                          onScanGenerate()
                        }
                        else if (key === 'translate') {
                          onTranslate()
                        }
                      }}
                    >
                      <Dropdown.Item id="subtitle" textValue="字幕生成">
                        <Icon className="size-4 text-muted" icon="lucide:captions" />
                        <Label>字幕生成</Label>
                      </Dropdown.Item>
                      <Dropdown.Item id="scan" textValue="扫描并生成">
                        <Icon className="size-4 text-muted" icon="lucide:folder-search" />
                        <Label>扫描并生成</Label>
                      </Dropdown.Item>
                      <Dropdown.Item id="translate" textValue="字幕翻译">
                        <Icon className="size-4 text-muted" icon="lucide:languages" />
                        <Label>字幕翻译</Label>
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown.Popover>
                </Dropdown>
                <Switch isSelected={execLogAutoRefresh} onChange={onExecLogAutoRefreshChange}>
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                  <Switch.Content>
                    <Label className="text-sm">自动刷新</Label>
                  </Switch.Content>
                </Switch>
              </div>
            </div>
            <div className="grid gap-2 lg:grid-cols-[auto_minmax(14rem,24rem)_auto] lg:items-center">
              <div className="flex flex-wrap items-center gap-1">
                {filterTabs.map(tab => (
                  <Button
                    key={tab.key}
                    size="sm"
                    variant={filter === tab.key ? 'primary' : 'tertiary'}
                    onPress={() => {
                      setFilter(tab.key)
                      setPage(1)
                    }}
                  >
                    {tab.label}
                    <Chip size="sm" variant="soft">
                      {filterCounts[tab.key]}
                    </Chip>
                  </Button>
                ))}
              </div>
              <div className="relative">
                <Icon className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted" icon="lucide:search" />
                <Input
                  className="pl-9"
                  value={q}
                  placeholder="Filter pipelines"
                  variant="secondary"
                  onChange={(event) => {
                    setQ(event.target.value)
                    setPage(1)
                  }}
                />
              </div>
              <div className="flex items-center gap-3 lg:justify-end">
                <span className="hidden text-xs text-muted 2xl:inline">服务端保留约 400 条事件</span>
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
          </Card.Content>
        </Card>

        <ListView
          aria-label="任务执行过程 Pipeline 列表"
          className="max-h-[calc(100dvh-16rem)] overflow-y-auto"
          items={pagedPipelines}
          selectionMode="none"
          variant="secondary"
          renderEmptyState={() => (
            <div className="flex items-center justify-center py-8 text-sm text-muted">
              {loading
                ? (
                    <div className="flex items-center gap-2">
                      <Spinner size="sm" />
                      加载中
                    </div>
                  )
                : '暂无 pipeline；提交任务并恢复调度后会显示执行过程。'}
            </div>
          )}
          onAction={(key) => {
            const pipeline = pagedPipelines.find(item => String(item.root.taskId) === String(key))
            if (pipeline) {
              openPipelineDetail(pipeline)
            }
          }}
        >
          {(pipeline) => {
            const stages = stageJobs(pipeline)
            const title = pipelineTitle(pipeline)
            const latestSummary = latestLineOf(pipeline.root)?.summary

            return (
              <ListView.Item
                id={String(pipeline.root.taskId)}
                key={pipeline.root.taskId}
                textValue={title}
                className="flex-nowrap items-center py-1.5"
              >
                <ListView.ItemContent className="min-w-0 flex-1 basis-0 items-center">
                  <div className="grid min-w-0 flex-1 gap-3 lg:grid-cols-[minmax(18rem,1fr)_minmax(10rem,15rem)_minmax(12rem,16rem)] lg:items-center">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <StatusChip task={{ ...pipeline.root, status: pipeline.status, percent: pipeline.percent }} />
                        <button
                          className="min-w-0 flex-1 truncate text-left text-sm font-medium text-accent hover:underline"
                          title={title}
                          type="button"
                          onClick={() => openPipelineDetail(pipeline)}
                        >
                          {title}
                        </button>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                          #
                          {pipeline.root.taskId}
                        </span>
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span className="max-w-56 truncate">{transJobType(pipeline.root.taskType)}</span>
                        <span className="tabular-nums">
                          {pipeline.jobs.length}
                          {' '}
                          jobs
                        </span>
                        <TaskDurationMeta task={pipeline.root} />
                        {pipeline.percent != null && (
                          <span className="tabular-nums text-accent">{formatPercent(pipeline.percent)}</span>
                        )}
                      </div>
                    </div>
                    <div className="min-w-0 lg:justify-self-center">
                      <PipelineStages
                        compact
                        jobs={stages}
                        selectedJobId={null}
                        onSelect={id => openPipelineDetail(pipeline, id)}
                      />
                    </div>
                    <div className="min-w-0 text-xs text-muted lg:text-right">
                      <div className="tabular-nums">{formatTaskmillTime(pipeline.latestAt)}</div>
                      <div className="mt-0.5 truncate text-xs" title={latestSummary}>
                        {latestSummary ?? '暂无事件'}
                      </div>
                    </div>
                  </div>
                </ListView.ItemContent>
              </ListView.Item>
            )
          }}
        </ListView>

        <div className="flex flex-col gap-2 text-sm text-muted md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums">
              显示
              {' '}
              {pageStart}
              -
              {pageEnd}
              {' '}
              / 共
              {' '}
              {totalPipelines}
              {' '}
              个 Pipeline
            </span>
            <Select
              className="w-24"
              value={String(pageSize)}
              variant="secondary"
              onChange={(value) => {
                const nextPageSize = Number(value)
                if (Number.isFinite(nextPageSize)) {
                  setPageSize(nextPageSize)
                  setPage(1)
                }
              }}
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {PIPELINE_PAGE_SIZE_OPTIONS.map(size => (
                    <ListBox.Item key={size} id={String(size)} textValue={`${size} / 页`}>
                      {size}
                      {' '}
                      / 页
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
          <Pagination className="w-full justify-end md:w-auto" size="sm">
            <Pagination.Content>
              <Pagination.Item>
                <Pagination.Previous isDisabled={currentPage <= 1} onPress={() => setPage(prev => Math.max(1, prev - 1))}>
                  <Pagination.PreviousIcon />
                  <span>上一页</span>
                </Pagination.Previous>
              </Pagination.Item>
              {pageItems.map(item => typeof item === 'string'
                ? (
                    <Pagination.Item key={item}>
                      <Pagination.Ellipsis />
                    </Pagination.Item>
                  )
                : (
                    <Pagination.Item key={item}>
                      <Pagination.Link isActive={item === currentPage} onPress={() => setPage(item)}>
                        {item}
                      </Pagination.Link>
                    </Pagination.Item>
                  ))}
              <Pagination.Item>
                <Pagination.Next isDisabled={currentPage >= totalPages} onPress={() => setPage(prev => Math.min(totalPages, prev + 1))}>
                  <span>下一页</span>
                  <Pagination.NextIcon />
                </Pagination.Next>
              </Pagination.Item>
            </Pagination.Content>
          </Pagination>
        </div>
      </div>

      <Drawer.Backdrop
        isOpen={Boolean(detailPipeline)}
        onOpenChange={(open) => {
          if (!open) {
            setDetailPipelineId(null)
            setSelectedJobId(null)
          }
        }}
      >
        <Drawer.Content placement="right">
          <Drawer.Dialog className="flex h-dvh w-full flex-col sm:max-w-3xl">
            <Drawer.CloseTrigger />
            <Drawer.Header className="shrink-0 pr-12">
              <div className="flex min-w-0 flex-col gap-2">
                <Drawer.Heading className="text-base">
                  <span className="block truncate" title={detailPipeline ? pipelineTitle(detailPipeline) : undefined}>
                    {detailPipeline ? pipelineTitle(detailPipeline) : 'Pipeline'}
                  </span>
                </Drawer.Heading>
                {detailPipeline && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                    <StatusChip task={{ ...detailPipeline.root, status: detailPipeline.status, percent: detailPipeline.percent }} />
                    <span className="font-mono tabular-nums">
                      #
                      {detailPipeline.root.taskId}
                    </span>
                    <span className="tabular-nums">
                      {detailPipeline.jobs.length}
                      {' '}
                      jobs
                    </span>
                    <TaskDurationMeta task={detailPipeline.root} />
                    {detailPipeline.percent != null && <span className="tabular-nums text-accent">{formatPercent(detailPipeline.percent)}</span>}
                    <span className="inline-flex items-center gap-1 tabular-nums">
                      <Icon className="size-3.5" icon="lucide:clock" />
                      {formatTaskmillTime(detailPipeline.latestAt)}
                    </span>
                  </div>
                )}
              </div>
            </Drawer.Header>
            <Drawer.Body className="min-h-0 flex-1 overflow-hidden px-3 pb-3">
              {detailPipeline && (
                <div className="flex min-h-0 flex-col overflow-hidden rounded-lg bg-surface-secondary">
                  <div className="flex min-w-0 items-center gap-3 px-3 py-2">
                    <span className="shrink-0 text-xs text-muted">阶段</span>
                    <div className="min-w-0 flex-1">
                      <PipelineStages
                        jobs={detailStages}
                        selectedJobId={selectedJob?.taskId ?? null}
                        onSelect={setSelectedJobId}
                      />
                    </div>
                  </div>
                  <div className="min-h-0 flex-1">
                    <JobLogView job={selectedJob} autoScroll={autoScroll} />
                  </div>
                </div>
              )}
            </Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </>
  )
}
