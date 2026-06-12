import type {
  TaskmillEstimatedProgress,
  TaskmillExecLogEntry,
  TaskmillJobSnapshot,
  TaskmillTaskHistoryRecord,
  TaskmillTaskRecord,
} from '@/api'
import type { EventTone, PipelineView, TaskEventLine, TaskLogGroup } from '@/components/taskmill-exec-log-shared'
import { clampTaskPercent, formatPercent } from '@/components/taskmill-exec-log-shared'

export const PIPELINE_PAGE_SIZE_OPTIONS = [10, 20, 50] as const
export const CANCELLABLE_STATUSES = new Set(['running', 'waiting', 'pending', 'paused', 'blocked'])
export const PAUSABLE_STATUSES = new Set(['pending', 'blocked'])
export const RESUMABLE_STATUSES = new Set(['paused'])
export const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'superseded', 'expired', 'dependency_failed', 'dead_letter'])
export const ACTIVE_STATUSES = new Set(['running', 'waiting', 'pending', 'paused', 'blocked'])
export const FAILED_STATUSES = new Set(['failed', 'dead_letter', 'dependency_failed', 'expired'])

const TASKMILL_GROUPS: Array<{ key: string, label: string, icon: string }> = [
  { key: 'media:subtitle-pipeline', label: '字幕 Pipeline', icon: 'lucide:workflow' },
  { key: 'media:whisper', label: 'Whisper', icon: 'lucide:audio-lines' },
  { key: 'media:translate', label: '翻译', icon: 'lucide:languages' },
  { key: 'media:setup-download', label: '设置下载', icon: 'lucide:download' },
  { key: 'media:scan', label: '媒体扫描', icon: 'lucide:folder-search' },
] as const

function taskTypeName(taskType: string): string {
  return taskType.split('::').at(-1) ?? taskType
}

function inferTaskGroup(taskType: string): string | null {
  switch (taskTypeName(taskType)) {
    case 'video-subtitle-generate':
    case 'video-subtitle-extract-wav':
      return 'media:subtitle-pipeline'
    case 'video-subtitle-recognize':
      return 'media:whisper'
    case 'subtitle-translate':
      return 'media:translate'
    case 'whisper-model-download':
    case 'ffmpeg-setup-download':
      return 'media:setup-download'
    case 'media-library-scan':
      return 'media:scan'
    default:
      return null
  }
}

function taskGroupKey(task: { group_key?: string | null, task_type: string }): string | null {
  return task.group_key?.trim() || inferTaskGroup(task.task_type)
}

interface TaskEventHeaderLike {
  task_id?: number
  key?: string
  label?: string
  task_type?: string
}

type TaskmillKnownTask = TaskmillTaskRecord | TaskmillTaskHistoryRecord
export type PipelineFilter = 'all' | 'active' | 'finished' | 'failed'
export type TaskmillViewMode = 'queue' | 'groups' | 'history'
export type PipelinePageItem = number | 'left-ellipsis' | 'right-ellipsis'

export interface TaskmillGroupLane {
  key: string
  label: string
  icon: string
  running: number
  pending: number
  allocatedSlots: number | null
  cap: number | null
  minSlots: number | null
  weight: number | null
  pausedTaskCount: number
  resumeAt: string | null
  rateLimit: {
    permits: number
    intervalMs: number
    burst: number
    availableTokens: number
  } | null
  pipelines: PipelineView[]
}

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

function decodePayloadObject(payload: number[] | null | undefined): Record<string, unknown> | undefined {
  if (!payload?.length) {
    return undefined
  }

  try {
    return asRecord(JSON.parse(new TextDecoder().decode(new Uint8Array(payload))))
  }
  catch {
    return undefined
  }
}

function labelAfter(label: string, prefix: string): string | undefined {
  return label.startsWith(prefix) ? label.slice(prefix.length).trim() : undefined
}

function normalizeTaskPath(value: string | undefined): string | undefined {
  const normalized = value?.trim().replaceAll('\\', '/').toLowerCase()
  return normalized || undefined
}

function pathWithoutExtension(value: string | undefined): string | undefined {
  const normalized = normalizeTaskPath(value)
  return normalized?.replace(/\.[^/.]+$/, '')
}

function sourceSrtSubject(value: string | undefined): string | undefined {
  return pathWithoutExtension(value)?.replace(/\.[a-z]{2,8}$/, '')
}

function historyVideoPath(task: TaskmillTaskHistoryRecord): string | undefined {
  const payload = decodePayloadObject(task.payload)
  return readString(payload?.video_path)
    ?? labelAfter(task.label, '字幕生成: ')
    ?? labelAfter(task.label, '提取字幕音频: ')
    ?? labelAfter(task.label, '识别字幕: ')
}

function historySubjectKey(task: TaskmillTaskHistoryRecord): string | undefined {
  if (task.task_type.endsWith('subtitle-translate')) {
    const payload = decodePayloadObject(task.payload)
    return sourceSrtSubject(readString(payload?.source_srt_path) ?? labelAfter(task.label, '字幕翻译: ')?.split(' -> ')[0])
  }
  return pathWithoutExtension(historyVideoPath(task))
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
  if (TERMINAL_STATUSES.has(current) && ['Dispatched', 'Progress', 'Waiting', 'Preempted'].includes(type)) {
    return current
  }

  switch (type) {
    case 'Dispatched':
    case 'Progress':
      return 'running'
    case 'Waiting':
      return 'waiting'
    case 'Completed':
      return 'completed'
    case 'Failed': {
      const data = asRecord(event.data)
      if (TERMINAL_STATUSES.has(current) && data?.will_retry === true) {
        return current
      }
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
  runtimeTaskId = task.id,
): TaskLogGroup {
  const isHistory = isHistoryTask(task)
  const completedAt = isHistoryTask(task) ? task.completed_at : null
  const identityKey = isHistory ? historyTaskKey(task.id) : activeTaskKey(task.id)
  const parentIdentityKey = task.parent_id != null ? activeTaskKey(task.parent_id) : null
  const existingPercent = clampTaskPercent(existing?.percent)
  return {
    identityKey,
    taskId: runtimeTaskId,
    historyRecordId: isHistory ? task.id : null,
    taskType: task.task_type,
    taskKey: task.key,
    label: task.label,
    parentIdentityKey,
    groupKey: taskGroupKey(task),
    priority: task.priority,
    retryCount: task.retry_count,
    lastError: task.last_error,
    dependencies: isHistory ? [] : task.dependencies,
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
    taskKey: group.taskKey || progress.header.key,
    label: group.label || progress.header.label,
    priority: group.priority ?? progress.header.base_priority,
    percent: percent ?? group.percent,
  }
}

export function buildTaskLogGroups(
  items: TaskmillExecLogEntry[] | undefined,
  activeItems: TaskmillTaskRecord[] | undefined,
  historyItems: TaskmillTaskHistoryRecord[] | undefined,
  progressItems: TaskmillEstimatedProgress[] | undefined,
): TaskLogGroup[] {
  const groups = new Map<string, TaskLogGroup>()
  const historyKeys = new Map<string, string>()
  const activeKeys = new Set<string>()
  const eventTaskIdsByKey = new Map<string, number>()
  const runtimeHistoryKeys = new Map<number, string>()
  const parentHistoryKeysBySubject = new Map<string, string>()

  for (const row of items ?? []) {
    const taskId = readEventTaskId(row.event)
    const header = readEventHeader(row.event)
    if (taskId != null && header?.key != null) {
      eventTaskIdsByKey.set(header.key, taskId)
    }
  }

  for (const task of historyItems ?? []) {
    const key = historyTaskKey(task.id)
    const runtimeTaskId = eventTaskIdsByKey.get(task.key) ?? task.id
    historyKeys.set(task.key, key)
    runtimeHistoryKeys.set(runtimeTaskId, key)
    if (task.parent_id == null && task.task_type.endsWith('video-subtitle-generate')) {
      const subjectKey = historySubjectKey(task)
      if (subjectKey) {
        parentHistoryKeysBySubject.set(subjectKey, key)
      }
    }
    groups.set(key, mergeTask(task, groups.get(key), runtimeTaskId))
  }

  for (const task of historyItems ?? []) {
    if (task.parent_id == null) {
      continue
    }
    const key = historyTaskKey(task.id)
    const subjectKey = historySubjectKey(task)
    const parentKey = runtimeHistoryKeys.get(task.parent_id)
      ?? (subjectKey != null ? parentHistoryKeysBySubject.get(subjectKey) : undefined)
    if (!parentKey) {
      continue
    }
    const group = groups.get(key)
    if (group) {
      groups.set(key, { ...group, parentIdentityKey: parentKey })
    }
  }

  for (const task of activeItems ?? []) {
    const key = activeTaskKey(task.id)
    activeKeys.add(key)
    groups.set(key, mergeTask(task, groups.get(key)))
  }

  for (const [index, row] of (items ?? []).entries()) {
    const taskId = readEventTaskId(row.event)
    if (taskId == null) {
      continue
    }

    const type = typeof row.event.type === 'string' ? row.event.type : '?'
    const header = readEventHeader(row.event)
    const activeKey = activeTaskKey(taskId)
    const historyKey = header?.key != null ? historyKeys.get(header.key) : undefined
    const groupKey = activeKeys.has(activeKey) ? activeKey : historyKey ?? activeKey
    if (groupKey !== activeKey && groups.has(activeKey)) {
      const activeGroup = groups.get(activeKey)!
      const targetGroup = groups.get(groupKey)
      groups.set(groupKey, {
        ...(targetGroup ?? activeGroup),
        latestAt: [targetGroup?.latestAt, activeGroup.latestAt].filter(Boolean).sort().at(-1) ?? activeGroup.latestAt,
        lines: [...(targetGroup?.lines ?? []), ...activeGroup.lines],
        percent: targetGroup?.percent ?? activeGroup.percent,
      })
      groups.delete(activeKey)
    }
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
      historyRecordId: existing?.historyRecordId ?? null,
      taskType: existing?.taskType ?? header?.task_type ?? '',
      taskKey: existing?.taskKey ?? header?.key ?? '',
      label: existing?.label ?? header?.label ?? '',
      parentIdentityKey: existing?.parentIdentityKey ?? null,
      groupKey: existing?.groupKey ?? null,
      priority: existing?.priority ?? null,
      retryCount: existing?.retryCount ?? null,
      lastError: existing?.lastError ?? null,
      dependencies: existing?.dependencies ?? [],
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
    job.percent != null || job.status === 'completed' || ACTIVE_STATUSES.has(job.status),
  )
  if (!hasProgressSignal) {
    return clampTaskPercent(root.percent)
  }

  const total = progressJobs.reduce((sum, job) => sum + terminalProgressValue(job), 0)
  return clampTaskPercent(total / progressJobs.length)
}

export function buildPipelineViews(groups: TaskLogGroup[]): PipelineView[] {
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
      const terminal = jobs.find(job => FAILED_STATUSES.has(job.status))
      const status = terminal?.status
        ?? (jobs.every(job => job.status === 'completed') ? 'completed' : root.status)
      const percent = derivePipelinePercent(root, jobs, status)
      const historyRecordId = jobs.find(job => job.historyRecordId != null)?.historyRecordId ?? null
      return { root, jobs, historyRecordId, latestAt, status, percent }
    })
    .sort((a, b) => new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime())
}

export function matchesFilter(pipeline: PipelineView, filter: PipelineFilter): boolean {
  switch (filter) {
    case 'finished':
      return pipeline.status === 'completed'
    case 'active':
      return ACTIVE_STATUSES.has(pipeline.status)
    case 'failed':
      return FAILED_STATUSES.has(pipeline.status)
    default:
      return true
  }
}

export function pipelineMatchesKeyword(pipeline: PipelineView, keyword: string): boolean {
  if (!keyword) {
    return true
  }
  const haystack = [
    pipeline.root.taskId,
    pipeline.root.label,
    pipeline.root.taskType,
    pipeline.root.groupKey,
    ...pipeline.jobs.flatMap(job => [job.taskId, job.label, job.taskType, job.groupKey]),
  ].join(' ').toLowerCase()
  return haystack.includes(keyword)
}

export function cancellableJobOf(pipeline: PipelineView): TaskLogGroup | undefined {
  return pipeline.jobs.find(job => CANCELLABLE_STATUSES.has(job.status))
}

export function pausableJobOf(pipeline: PipelineView): TaskLogGroup | undefined {
  return pipeline.jobs.find(job => PAUSABLE_STATUSES.has(job.status))
}

export function resumableJobOf(pipeline: PipelineView): TaskLogGroup | undefined {
  return pipeline.jobs.find(job => RESUMABLE_STATUSES.has(job.status))
}

export function historyRecordIdOf(pipeline: PipelineView): number | null {
  if (pipeline.historyRecordId != null) {
    return pipeline.historyRecordId
  }
  if (pipeline.root.historyRecordId != null) {
    return pipeline.root.historyRecordId
  }
  return null
}

export function paginationItems(page: number, totalPages: number): PipelinePageItem[] {
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

export function pagePipelines(pipelines: PipelineView[], page: number, pageSize: number, hasMore = false) {
  const total = pipelines.length
  const loadedPages = Math.max(1, Math.ceil(total / pageSize))
  const totalPages = loadedPages + (hasMore ? 1 : 0)
  const currentPage = Math.min(page, totalPages)
  const slicePage = Math.min(currentPage, loadedPages)
  const pageStart = total === 0 ? 0 : (slicePage - 1) * pageSize + 1
  const pageEnd = Math.min(slicePage * pageSize, total)

  return {
    currentPage,
    hasMore,
    loadedPages,
    pageEnd,
    pageItems: paginationItems(currentPage, totalPages),
    pageStart,
    rows: pipelines.slice((slicePage - 1) * pageSize, slicePage * pageSize),
    total,
    totalPages,
  }
}

export function pipelineLaneKey(pipeline: PipelineView): string {
  return pipeline.root.groupKey
    ?? pipeline.jobs.find(job => job.groupKey)?.groupKey
    ?? inferTaskGroup(pipeline.root.taskType)
    ?? 'ungrouped'
}

export function groupLabel(key: string | null | undefined): string {
  if (!key) {
    return '未分组'
  }
  if (key === 'ungrouped') {
    return '未分组'
  }
  return TASKMILL_GROUPS.find(group => group.key === key)?.label ?? key
}

export function groupIcon(key: string | null | undefined): string {
  if (!key) {
    return 'lucide:circle-help'
  }
  if (key === 'ungrouped') {
    return 'lucide:circle-help'
  }
  return TASKMILL_GROUPS.find(group => group.key === key)?.icon ?? 'lucide:package'
}

export function buildTaskmillGroupLanes(
  snapshot: TaskmillJobSnapshot | undefined,
  activeItems: TaskmillTaskRecord[] | undefined,
  pipelines: PipelineView[],
): TaskmillGroupLane[] {
  const allocations = new Map((snapshot?.scheduler.group_allocations ?? []).map(item => [item.group, item]))
  const pausedGroups = new Map((snapshot?.scheduler.paused_groups ?? []).map(item => [item.group, item]))
  const rateLimits = new Map((snapshot?.scheduler.rate_limits ?? []).map(item => [item.scope, item]))
  const activeByGroup = new Map<string, { running: number, pending: number }>()
  const pipelinesByGroup = new Map<string, PipelineView[]>()
  const keys = new Set<string>(TASKMILL_GROUPS.map(group => group.key))

  for (const item of activeItems ?? []) {
    const key = taskGroupKey(item) ?? 'ungrouped'
    keys.add(key)
    const current = activeByGroup.get(key) ?? { running: 0, pending: 0 }
    if (item.status === 'running') {
      current.running += 1
    }
    else if (['pending', 'blocked', 'paused', 'waiting'].includes(item.status)) {
      current.pending += 1
    }
    activeByGroup.set(key, current)
  }

  for (const pipeline of pipelines) {
    if (!ACTIVE_STATUSES.has(pipeline.status)) {
      continue
    }
    const key = pipelineLaneKey(pipeline)
    keys.add(key)
    const rows = pipelinesByGroup.get(key) ?? []
    rows.push(pipeline)
    pipelinesByGroup.set(key, rows)
  }

  for (const item of snapshot?.scheduler.group_allocations ?? []) {
    keys.add(item.group)
  }
  for (const item of snapshot?.scheduler.paused_groups ?? []) {
    keys.add(item.group)
  }
  for (const item of snapshot?.scheduler.rate_limits ?? []) {
    if (item.scope_kind === 'group') {
      keys.add(item.scope)
    }
  }

  const order = new Map(TASKMILL_GROUPS.map((group, index) => [group.key, index]))

  return Array.from(keys)
    .map((key) => {
      const allocation = allocations.get(key)
      const paused = pausedGroups.get(key)
      const active = activeByGroup.get(key)
      const rateLimit = rateLimits.get(key)

      return {
        key,
        label: groupLabel(key),
        icon: groupIcon(key),
        running: allocation?.running ?? active?.running ?? 0,
        pending: allocation?.pending ?? active?.pending ?? 0,
        allocatedSlots: allocation?.allocated_slots ?? null,
        cap: allocation?.cap ?? null,
        minSlots: allocation?.min_slots ?? null,
        weight: allocation?.weight ?? null,
        pausedTaskCount: paused?.paused_task_count ?? 0,
        resumeAt: paused?.resume_at ?? null,
        rateLimit: rateLimit
          ? {
              permits: rateLimit.permits,
              intervalMs: rateLimit.interval_ms,
              burst: rateLimit.burst,
              availableTokens: rateLimit.available_tokens,
            }
          : null,
        pipelines: pipelinesByGroup.get(key) ?? [],
      }
    })
    .sort((a, b) => {
      const ai = order.get(a.key) ?? Number.MAX_SAFE_INTEGER
      const bi = order.get(b.key) ?? Number.MAX_SAFE_INTEGER
      if (ai !== bi) {
        return ai - bi
      }
      return a.label.localeCompare(b.label)
    })
}
