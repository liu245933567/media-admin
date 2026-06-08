import type {
  TaskmillEstimatedProgress,
  TaskmillExecLogEntry,
  TaskmillTaskHistoryRecord,
  TaskmillTaskRecord,
} from '@/api'
import type { EventTone, PipelineView, TaskEventLine, TaskLogGroup } from '@/components/taskmill-exec-log-shared'
import { ListView } from '@heroui-pro/react/list-view'
import { Button, Card, Dropdown, Input, Label, ListBox, Pagination, Select, Spinner, Tooltip } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { cancelTaskJobs, deleteHistoryJobs } from '@/api'
import { useAppToast } from '@/components/app-toast'
import { useConfirmDialog } from '@/components/confirm-dialog'
import { transJobType } from '@/components/taskmill-active-tasks-panel'
import {
  clampTaskPercent,
  formatPercent,
  latestLineOf,
  pipelineTitle,
  stageJobs,
  stageName,
  StatusChip,
  statusIcon,
  TaskDurationMeta,
  TaskProgressCircle,
  taskStatusColor,
} from '@/components/taskmill-exec-log-shared'
import { TaskmillPipelineDetailDrawer } from '@/components/taskmill-pipeline-detail-drawer'
import { TaskmillQueueControls } from '@/components/taskmill-queue-controls'
import { formatTaskmillTime } from '@/lib/taskmill-time'

const PIPELINE_PAGE_SIZE_OPTIONS = [10, 20, 50] as const
const CANCELLABLE_STATUSES = new Set(['running', 'waiting', 'pending', 'paused', 'blocked'])

interface TaskEventHeaderLike {
  task_id?: number
  label?: string
  task_type?: string
}

type TaskmillKnownTask = TaskmillTaskRecord | TaskmillTaskHistoryRecord
type PipelineFilter = 'all' | 'running' | 'finished' | 'failed'
type PipelinePageItem = number | 'left-ellipsis' | 'right-ellipsis'

function activeTaskKey(taskId: number): string {
  return `task:${taskId}`
}

function historyTaskKey(historyId: number): string {
  return `history:${historyId}`
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

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function isHistoryTask(task: TaskmillKnownTask): task is TaskmillTaskHistoryRecord {
  return 'completed_at' in task
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
      const percent = clampTaskPercent(data?.percent)
      const pct = percent == null
        ? ''
        : formatPercent(percent)
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
      const percent = clampTaskPercent(data?.percent)
      const message = readString(data?.message)
      return {
        percent: percent ?? undefined,
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
  const isHistory = isHistoryTask(task)
  const completedAt = isHistoryTask(task) ? task.completed_at : null
  const identityKey = isHistory ? historyTaskKey(task.id) : activeTaskKey(task.id)
  const parentIdentityKey = !isHistory && task.parent_id != null ? activeTaskKey(task.parent_id) : null
  const existingPercent = clampTaskPercent(existing?.percent)
  return {
    identityKey,
    taskId: task.id,
    taskType: task.task_type,
    label: task.label,
    parentIdentityKey,
    isHistory: isHistory || existing?.isHistory === true,
    status: task.status,
    createdAt: task.created_at,
    startedAt: task.started_at,
    completedAt,
    durationMs: isHistoryTask(task) ? task.duration_ms : null,
    latestAt: completedAt ?? task.started_at ?? task.created_at,
    percent: task.status === 'completed' ? 1 : existingPercent,
    lines: existing?.lines ?? [],
  }
}

function mergeEstimatedProgress(
  group: TaskLogGroup,
  progress: TaskmillEstimatedProgress,
): TaskLogGroup {
  const percent = clampTaskPercent(progress.percent)

  return {
    ...group,
    taskType: group.taskType || progress.header.task_type,
    label: group.label || progress.header.label,
    percent: percent ?? group.percent,
  }
}

function buildTaskLogGroups(
  items: TaskmillExecLogEntry[] | undefined,
  activeItems: TaskmillTaskRecord[] | undefined,
  historyItems: TaskmillTaskHistoryRecord[] | undefined,
  progressItems: TaskmillEstimatedProgress[] | undefined,
): TaskLogGroup[] {
  const groups = new Map<string, TaskLogGroup>()

  for (const task of historyItems ?? []) {
    const key = historyTaskKey(task.id)
    groups.set(key, mergeTask(task, groups.get(key)))
  }
  for (const task of activeItems ?? []) {
    const key = activeTaskKey(task.id)
    groups.set(key, mergeTask(task, groups.get(key)))
  }

  for (const [index, row] of (items ?? []).entries()) {
    const taskId = readEventTaskId(row.event)
    if (taskId == null) {
      continue
    }

    const type = typeof row.event.type === 'string' ? row.event.type : '?'
    const header = readEventHeader(row.event)
    const groupKey = activeTaskKey(taskId)
    const existing = groups.get(groupKey)
    const formatted = formatProcessEventSummary(row.event)
    const status = deriveStatusFromEvent(type, row.event, existing?.status ?? 'pending')
    const percent = formatted.percent ?? clampTaskPercent(existing?.percent)

    const line: TaskEventLine = {
      key: `${row.received_at}-${type}-${index}`,
      type,
      receivedAt: row.received_at,
      summary: formatted.summary || eventLabel(type),
      percent: formatted.percent,
      tone: eventTone(type),
    }

    groups.set(groupKey, {
      identityKey: groupKey,
      taskId,
      taskType: existing?.taskType ?? header?.task_type ?? '',
      label: existing?.label ?? header?.label ?? '',
      parentIdentityKey: existing?.parentIdentityKey ?? null,
      isHistory: existing?.isHistory ?? false,
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

  for (const progress of progressItems ?? []) {
    const taskId = progress.header.task_id
    const existing = groups.get(activeTaskKey(taskId))
    if (existing) {
      groups.set(existing.identityKey, mergeEstimatedProgress(existing, progress))
    }
  }

  return Array.from(groups.values())
}

function terminalProgressValue(job: TaskLogGroup): number {
  if (job.status === 'completed') {
    return 1
  }
  return clampTaskPercent(job.percent) ?? 0
}

function derivePipelinePercent(root: TaskLogGroup, jobs: TaskLogGroup[], status: string): number | null {
  if (status === 'completed') {
    return 1
  }

  const progressJobs = jobs.length > 1
    ? jobs.filter(job => job.identityKey !== root.identityKey)
    : jobs
  if (progressJobs.length === 0) {
    return clampTaskPercent(root.percent)
  }

  const hasProgressSignal = progressJobs.some(job =>
    job.percent != null || job.status === 'completed' || ['running', 'waiting', 'pending', 'paused', 'blocked'].includes(job.status),
  )
  if (!hasProgressSignal) {
    return clampTaskPercent(root.percent)
  }

  const total = progressJobs.reduce((sum, job) => sum + terminalProgressValue(job), 0)
  return clampTaskPercent(total / progressJobs.length)
}

function buildPipelineViews(groups: TaskLogGroup[]): PipelineView[] {
  const byKey = new Map(groups.map(group => [group.identityKey, group]))
  const childrenByParent = new Map<string, TaskLogGroup[]>()

  const createsParentCycle = (group: TaskLogGroup): boolean => {
    const seen = new Set<string>([group.identityKey])
    let parentIdentityKey = group.parentIdentityKey
    while (parentIdentityKey != null) {
      if (seen.has(parentIdentityKey)) {
        return true
      }
      seen.add(parentIdentityKey)
      parentIdentityKey = byKey.get(parentIdentityKey)?.parentIdentityKey ?? null
    }
    return false
  }

  for (const group of groups) {
    if (group.parentIdentityKey != null && byKey.has(group.parentIdentityKey) && !createsParentCycle(group)) {
      const children = childrenByParent.get(group.parentIdentityKey) ?? []
      children.push(group)
      childrenByParent.set(group.parentIdentityKey, children)
    }
  }

  const readRoot = (group: TaskLogGroup): TaskLogGroup => {
    let current = group
    const seen = new Set<string>()
    while (
      current.parentIdentityKey != null
      && byKey.has(current.parentIdentityKey)
      && !seen.has(current.parentIdentityKey)
    ) {
      seen.add(current.identityKey)
      current = byKey.get(current.parentIdentityKey)!
    }
    return current
  }

  const roots = new Map<string, TaskLogGroup>()
  for (const group of groups) {
    const root = readRoot(group)
    roots.set(root.identityKey, root)
  }

  const collectJobs = (root: TaskLogGroup): TaskLogGroup[] => {
    const jobs: TaskLogGroup[] = []
    const visited = new Set<string>()
    const visit = (task: TaskLogGroup) => {
      if (visited.has(task.identityKey)) {
        return
      }
      visited.add(task.identityKey)
      jobs.push(task)
      const children = [...(childrenByParent.get(task.identityKey) ?? [])].sort(
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
      const percent = derivePipelinePercent(root, jobs, status)
      return { root, jobs, latestAt, status, percent }
    })
    .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime())
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

function cancellableJobOf(pipeline: PipelineView): TaskLogGroup | undefined {
  return pipeline.jobs.find(job => CANCELLABLE_STATUSES.has(job.status))
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

function PipelineStages({
  jobs,
  selectedJobKey,
  onSelect,
  compact,
}: {
  jobs: TaskLogGroup[]
  selectedJobKey: string | null
  onSelect: (key: string) => void
  compact?: boolean
}) {
  if (jobs.length === 0) {
    return <span className="text-sm text-muted">暂无子任务</span>
  }

  return (
    <div className="flex min-w-0 items-center overflow-x-auto py-0.5">
      {jobs.map((job, index) => (
        <div key={job.identityKey} className="flex items-center">
          {index > 0 && <span className={compact ? 'h-px w-4 shrink-0 bg-divider' : 'h-px w-8 shrink-0 bg-divider'} />}
          <button
            className="group flex shrink-0 flex-col items-center gap-1.5 text-left"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onSelect(job.identityKey)
            }}
          >
            {stageDot(job, selectedJobKey === job.identityKey)}
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

interface TaskmillExecLogPanelProps {
  items: TaskmillExecLogEntry[] | undefined
  activeItems?: TaskmillTaskRecord[]
  historyItems?: TaskmillTaskHistoryRecord[]
  progressItems?: TaskmillEstimatedProgress[]
  loading?: boolean
  onQueueChanged: () => void
  onCreateSubtitle: () => void
  onScanGenerate: () => void
  onTranslate: () => void
}

export function TaskmillExecLogPanel({
  items,
  activeItems,
  historyItems,
  progressItems,
  loading,
  onQueueChanged,
  onCreateSubtitle,
  onScanGenerate,
  onTranslate,
}: TaskmillExecLogPanelProps) {
  const message = useAppToast()
  const confirm = useConfirmDialog()
  const [filter, setFilter] = useState<PipelineFilter>('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PIPELINE_PAGE_SIZE_OPTIONS[0])
  const [detailPipelineKey, setDetailPipelineKey] = useState<string | null>(null)
  const [selectedJobKey, setSelectedJobKey] = useState<string | null>(null)

  const cancelMutation = useMutation({
    mutationFn: (id: number) => cancelTaskJobs(id),
    onSuccess: (res) => {
      if (res.cancelled) {
        message.success('已取消任务')
      }
      else {
        message.warning('未找到可取消的任务')
      }
      onQueueChanged()
    },
    onError: (e) => {
      message.error((e as Error).message || '取消失败')
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteHistoryJobs(id),
    onSuccess: (res) => {
      if (res.deleted) {
        message.success('已删除任务记录')
      }
      else {
        message.warning('未找到可删除的任务记录')
      }
      onQueueChanged()
    },
    onError: (e) => {
      message.error((e as Error).message || '删除失败')
    },
  })
  const actionPending = cancelMutation.isPending || deleteMutation.isPending

  const groups = useMemo(
    () => buildTaskLogGroups(items, activeItems, historyItems, progressItems),
    [activeItems, historyItems, items, progressItems],
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
    () => pipelines.find(pipeline => pipeline.root.identityKey === detailPipelineKey),
    [detailPipelineKey, pipelines],
  )
  const detailStages = detailPipeline ? stageJobs(detailPipeline) : []
  const selectedJob = detailStages.find(job => job.identityKey === selectedJobKey)
    ?? detailStages[0]
    ?? detailPipeline?.root
  function openPipelineDetail(pipeline: PipelineView, jobKey?: string) {
    const stages = stageJobs(pipeline)
    setDetailPipelineKey(pipeline.root.identityKey)
    setSelectedJobKey(jobKey ?? (stages[0] ?? pipeline.root).identityKey)
  }

  function confirmCancelPipeline(pipeline: PipelineView) {
    const job = cancellableJobOf(pipeline)
    if (!job) {
      return
    }

    confirm({
      title: '取消此任务？',
      description: `将取消任务 #${job.taskId}，运行中的执行会停止并进入历史。`,
      confirmText: '取消任务',
      danger: true,
      onConfirm: () => cancelMutation.mutateAsync(job.taskId),
    })
  }

  function confirmDeletePipeline(pipeline: PipelineView) {
    confirm({
      title: '删除此任务记录？',
      description: `将删除任务 #${pipeline.root.taskId} 的历史记录，此操作不可恢复。`,
      confirmText: '删除',
      danger: true,
      onConfirm: () => deleteMutation.mutateAsync(pipeline.root.taskId),
    })
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
      <div className="grid min-h-0 w-full flex-1 grid-rows-[auto_minmax(0,1fr)_auto] gap-3">
        <Card>
          <Card.Content className="grid gap-2 xl:grid-cols-[auto_minmax(0,1fr)_minmax(14rem,22rem)_auto] xl:items-center">
            <Select
              aria-label="任务状态筛选"
              className="w-36"
              value={filter}
              variant="secondary"
              onChange={(value) => {
                if (typeof value !== 'string') {
                  return
                }
                setFilter(value as PipelineFilter)
                setPage(1)
              }}
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {filterTabs.map(tab => (
                    <ListBox.Item key={tab.key} id={tab.key} textValue={`${tab.label} ${filterCounts[tab.key]}`}>
                      <span>{tab.label}</span>
                      <span className="ml-auto text-xs tabular-nums text-muted">{filterCounts[tab.key]}</span>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <div className="relative min-w-0">
              <Icon className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted" icon="lucide:search" />
              <Input
                className="pl-9"
                value={q}
                placeholder="搜索任务"
                variant="secondary"
                onChange={(event) => {
                  setQ(event.target.value)
                  setPage(1)
                }}
              />
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 xl:justify-end">
              <TaskmillQueueControls onChanged={onQueueChanged} />
              <Dropdown>
                <Button aria-label="新建" size="sm" variant="secondary">
                  <Icon className="size-4" icon="lucide:plus" />
                  新建
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
            </div>
          </Card.Content>
        </Card>

        <div className="min-h-0 overflow-y-auto">
          <ListView
            aria-label="任务执行过程 Pipeline 列表"
            className="min-h-full"
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
              const pipeline = pagedPipelines.find(item => item.root.identityKey === String(key))
              if (pipeline) {
                openPipelineDetail(pipeline)
              }
            }}
          >
            {(pipeline) => {
              const stages = stageJobs(pipeline)
              const title = pipelineTitle(pipeline)
              const latestSummary = latestLineOf(pipeline.root)?.summary
              const cancellableJob = cancellableJobOf(pipeline)
              const canDelete = pipeline.root.isHistory

              return (
                <ListView.Item
                  id={pipeline.root.identityKey}
                  key={pipeline.root.identityKey}
                  textValue={title}
                  className="flex-nowrap items-center py-1.5"
                >
                  <ListView.ItemContent className="min-w-0 flex-1 basis-0 items-center">
                    <div className="grid min-w-0 flex-1 gap-3 lg:grid-cols-[minmax(18rem,1fr)_minmax(8rem,11rem)_minmax(10rem,14rem)_minmax(12rem,16rem)] lg:items-center">
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
                        </div>
                      </div>
                      <TaskProgressCircle className="lg:justify-self-start" percent={pipeline.percent} />
                      <div className="min-w-0 lg:justify-self-center">
                        <PipelineStages
                          compact
                          jobs={stages}
                          selectedJobKey={null}
                          onSelect={key => openPipelineDetail(pipeline, key)}
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
                  <ListView.ItemAction className="flex items-center gap-1" aria-label="任务操作栏">
                    <Tooltip delay={0} isDisabled={Boolean(cancellableJob)}>
                      <Button
                        isIconOnly
                        aria-label="取消任务"
                        isDisabled={!cancellableJob || actionPending}
                        isPending={cancelMutation.isPending}
                        size="sm"
                        variant="tertiary"
                        onClick={event => event.stopPropagation()}
                        onPress={() => confirmCancelPipeline(pipeline)}
                      >
                        <Icon className="size-4" icon="lucide:ban" />
                      </Button>
                      <Tooltip.Content>当前任务不可取消</Tooltip.Content>
                    </Tooltip>
                    <Tooltip delay={0} isDisabled={!canDelete}>
                      <Button
                        isIconOnly
                        aria-label="删除任务记录"
                        isDisabled={!canDelete || actionPending}
                        isPending={deleteMutation.isPending}
                        size="sm"
                        variant="danger-soft"
                        onClick={event => event.stopPropagation()}
                        onPress={() => confirmDeletePipeline(pipeline)}
                      >
                        <Icon className="size-4" icon="lucide:trash-2" />
                      </Button>
                      <Tooltip.Content>仅历史任务可删除</Tooltip.Content>
                    </Tooltip>
                  </ListView.ItemAction>
                </ListView.Item>
              )
            }}
          </ListView>
        </div>

        <div className="flex shrink-0 flex-col gap-2 text-sm text-muted md:flex-row md:items-center md:justify-between">
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

      <TaskmillPipelineDetailDrawer
        autoScroll
        pipeline={detailPipeline}
        selectedJob={selectedJob}
        selectedJobKey={selectedJob?.identityKey ?? null}
        stages={detailStages}
        onClose={() => {
          setDetailPipelineKey(null)
          setSelectedJobKey(null)
        }}
        onSelectedJobKeyChange={setSelectedJobKey}
      />
    </>
  )
}
