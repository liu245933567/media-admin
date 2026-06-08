import type { ReactNode } from 'react'
import { Chip, ProgressCircle } from '@heroui/react'
import { Icon } from '@iconify/react'
import { transJobType, transStatus } from '@/components/taskmill-active-tasks-panel'
import { formatTaskmillTime } from '@/lib/taskmill-time'

export type EventTone = 'default' | 'accent' | 'success' | 'warning' | 'danger'

export interface TaskEventLine {
  key: string
  type: string
  receivedAt: string
  summary: string
  percent?: number
  tone: EventTone
}

export interface TaskLogGroup {
  identityKey: string
  taskId: number
  taskType: string
  label: string
  parentIdentityKey: string | null
  isHistory: boolean
  status: string
  createdAt: string | null
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  latestAt: string
  percent: number | null
  lines: TaskEventLine[]
}

export interface PipelineView {
  root: TaskLogGroup
  jobs: TaskLogGroup[]
  status: string
  latestAt: string
  percent: number | null
}

export function taskStatusColor(status: string): EventTone {
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

export function statusIcon(status: string): string {
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

export function clampTaskPercent(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : null
}

export function formatPercent(percent: number): string {
  const safePercent = clampTaskPercent(percent) ?? 0
  return `${Math.round(safePercent * 1000) / 10}%`
}

export function progressCircleValue(percent: number): number {
  return (clampTaskPercent(percent) ?? 0) * 100
}

export function formatDurationMs(value: number | null | undefined): string {
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

export function durationBetween(start: string | null, end: string | null): number | null {
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

export function latestLineOf(task: TaskLogGroup): TaskEventLine | undefined {
  return task.lines.at(-1)
}

export function pipelineTitle(pipeline: PipelineView): string {
  return pipeline.root.label || transJobType(pipeline.root.taskType) || `任务 #${pipeline.root.taskId}`
}

export function stageName(task: TaskLogGroup): string {
  const label = transJobType(task.taskType)
  if (label) {
    return label
  }
  return task.label || `任务 #${task.taskId}`
}

export function stageJobs(pipeline: PipelineView): TaskLogGroup[] {
  if (pipeline.jobs.length <= 1) {
    return pipeline.jobs
  }
  return pipeline.jobs.filter(job => job.identityKey !== pipeline.root.identityKey)
}

export function StatusChip({ task }: { task: TaskLogGroup }) {
  return (
    <Chip color={taskStatusColor(task.status)} size="sm" variant="soft">
      <Icon className={task.status === 'running' ? 'size-3.5 animate-spin' : 'size-3.5'} icon={statusIcon(task.status)} />
      {transStatus(task.status)}
    </Chip>
  )
}

export function TaskDurationMeta({ task }: { task: TaskLogGroup }) {
  const duration = task.durationMs ?? durationBetween(task.startedAt, task.completedAt ?? task.latestAt)

  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Icon className="size-3.5" icon="lucide:timer" />
      {formatDurationMs(duration)}
    </span>
  )
}

export function TaskProgressCircle({
  percent,
  className,
}: {
  percent: number | null
  className?: string
}) {
  if (percent == null) {
    return (
      <div className={['inline-flex items-center gap-2 text-xs text-muted', className].filter(Boolean).join(' ')}>
        <ProgressCircle aria-label="任务进度" color="default" size="sm" value={0}>
          <ProgressCircle.Track>
            <ProgressCircle.TrackCircle />
            <ProgressCircle.FillCircle />
          </ProgressCircle.Track>
        </ProgressCircle>
        <span className="w-10 text-right tabular-nums">-</span>
      </div>
    )
  }

  return (
    <div className={['inline-flex items-center gap-2', className].filter(Boolean).join(' ')}>
      <ProgressCircle
        aria-label="任务进度"
        color={percent >= 1 ? 'success' : 'accent'}
        size="sm"
        value={progressCircleValue(percent)}
      >
        <ProgressCircle.Track>
          <ProgressCircle.TrackCircle />
          <ProgressCircle.FillCircle />
        </ProgressCircle.Track>
      </ProgressCircle>
      <span className="w-10 text-right text-xs tabular-nums text-accent">{formatPercent(percent)}</span>
    </div>
  )
}

export function TaskMetaItem({
  icon,
  children,
}: {
  icon: string
  children: ReactNode
}) {
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Icon className="size-3.5" icon={icon} />
      {children}
    </span>
  )
}

export { formatTaskmillTime }
