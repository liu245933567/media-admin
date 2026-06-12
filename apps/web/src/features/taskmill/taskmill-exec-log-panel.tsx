import type { Key } from 'react'
import type { Selection } from 'react-aria-components/GridList'
import type {
  TaskmillEstimatedProgress,
  TaskmillExecLogEntry,
  TaskmillJobSnapshot,
  TaskmillTaskHistoryRecord,
  TaskmillTaskRecord,
} from '@/api'
import type { PipelineView } from '@/features/taskmill/taskmill-exec-log-shared'
import type { PipelineFilter, TaskmillGroupLane, TaskmillViewMode } from '@/features/taskmill/taskmill-view-model'
import { ActionBar } from '@heroui-pro/react/action-bar'
import { ListView } from '@heroui-pro/react/list-view'
import {
  Button,
  Chip,
  Dropdown,
  Input,
  Label,
  ListBox,
  ProgressBar,
  Select,
  Separator,
  Spinner,
  Surface,
  Tabs,
  Tooltip,
} from '@heroui/react'
import { Icon } from '@iconify/react'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { cancelTaskJobs, deleteHistoryJobs, pauseTaskJobs, resumeTaskJobs } from '@/api'
import { useAppToast } from '@/components/app-toast'
import { BasePagination } from '@/components/base-pagination'
import { useConfirmDialog } from '@/components/confirm-dialog'
import { transJobType } from '@/features/taskmill/taskmill-active-tasks-panel'
import {
  formatPercent,
  latestLineOf,
  pipelineTitle,
  stageJobs,
  stageName,
  StatusChip,
  TaskDurationMeta,
} from '@/features/taskmill/taskmill-exec-log-shared'
import { TaskmillPipelineDetailDrawer } from '@/features/taskmill/taskmill-pipeline-detail-drawer'
import { TaskmillQueueControls } from '@/features/taskmill/taskmill-queue-controls'
import {
  ACTIVE_STATUSES,
  buildPipelineViews,
  buildTaskLogGroups,
  buildTaskmillGroupLanes,
  cancellableJobOf,
  FAILED_STATUSES,
  groupLabel,
  historyRecordIdOf,
  matchesFilter,
  pagePipelines,
  pausableJobOf,
  PIPELINE_PAGE_SIZE_OPTIONS,
  pipelineLaneKey,
  pipelineMatchesKeyword,
  resumableJobOf,
} from '@/features/taskmill/taskmill-view-model'
import { formatTaskmillTime } from '@/lib/taskmill-time'

interface TaskmillExecLogPanelProps {
  items: TaskmillExecLogEntry[] | undefined
  activeItems?: TaskmillTaskRecord[]
  historyItems?: TaskmillTaskHistoryRecord[]
  progressItems?: TaskmillEstimatedProgress[]
  snapshot?: TaskmillJobSnapshot
  loading?: boolean
  historyHasMore?: boolean
  historyLoadingMore?: boolean
  onQueueChanged: () => void
  onCreateSubtitle: () => void
  onHistoryLoadMore?: () => Promise<unknown>
  onScanGenerate: () => void
  onTranslate: () => void
}

interface PipelineListProps {
  actionPending: boolean
  emptyText: string
  items: PipelineView[]
  loading?: boolean
  selectedKeys?: Selection
  selectionMode?: 'multiple' | 'none'
  onCancel: (pipeline: PipelineView) => void
  onDelete: (pipeline: PipelineView) => void
  onOpen: (pipeline: PipelineView) => void
  onPause: (pipeline: PipelineView) => void
  onResume: (pipeline: PipelineView) => void
  onSelectionChange?: (keys: Selection) => void
}

function percentValue(percent: number | null | undefined): number {
  return percent == null ? 0 : Math.round(percent * 1000) / 10
}

function metricValue(value: number | undefined): string {
  return String(value ?? 0)
}

function pressureColor(value: number | undefined): 'accent' | 'warning' | 'danger' {
  const pressure = value ?? 0
  if (pressure >= 0.85) {
    return 'danger'
  }
  if (pressure >= 0.6) {
    return 'warning'
  }
  return 'accent'
}

function SchedulerMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: string
  label: string
  value: string
  detail: string
}) {
  return (
    <Surface className="flex min-w-0 items-center gap-2 rounded-lg px-3 py-2.5" variant="secondary">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-muted">
        <Icon className="size-3.5" icon={icon} />
      </span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <div className="truncate text-xs text-muted">{label}</div>
          <div className="shrink-0 truncate text-base font-semibold leading-none tabular-nums text-foreground">{value}</div>
        </div>
        <div className="mt-0.5 truncate text-[11px] leading-4 text-muted">{detail}</div>
      </div>
    </Surface>
  )
}

function SchedulerOverview({
  snapshot,
  activeCount,
  failedCount,
  completedTaskCount,
  onQueueChanged,
}: {
  snapshot?: TaskmillJobSnapshot
  activeCount: number
  failedCount: number
  completedTaskCount: number
  onQueueChanged: () => void
}) {
  const scheduler = snapshot?.scheduler
  const metrics = snapshot?.metrics
  const pressure = scheduler?.pressure ?? metrics?.pressure ?? 0
  const running = metrics?.running ?? scheduler?.running.length ?? 0
  const maxConcurrency = scheduler?.max_concurrency ?? metrics?.max_concurrency ?? 0

  return (
    <Surface className="grid gap-2 rounded-lg p-3 xl:grid-cols-[minmax(12rem,0.85fr)_minmax(0,2fr)_minmax(14rem,0.9fr)]" variant="default">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip color={scheduler?.is_paused ? 'warning' : 'success'} size="sm" variant="soft">
            <Icon className="size-3.5" icon={scheduler?.is_paused ? 'lucide:pause' : 'lucide:activity'} />
            {scheduler?.is_paused ? '调度已暂停' : '调度运行中'}
          </Chip>
        </div>
        <div className="mt-1">
          <TaskmillQueueControls isPaused={scheduler?.is_paused} onChanged={onQueueChanged} />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <SchedulerMetric
          detail={`最大并发 ${maxConcurrency}`}
          icon="lucide:cpu"
          label="运行槽位"
          value={`${running}/${maxConcurrency}`}
        />
        <SchedulerMetric
          detail={`活跃 Pipeline ${activeCount}`}
          icon="lucide:list-checks"
          label="队列积压"
          value={metricValue(metrics?.pending ?? scheduler?.pending_count)}
        />
        <SchedulerMetric
          detail={`等待 ${metricValue(metrics?.waiting ?? scheduler?.waiting_count)} / 暂停 ${metricValue(metrics?.paused ?? scheduler?.paused_count)}`}
          icon="lucide:git-branch"
          label="阻塞任务"
          value={metricValue(metrics?.blocked ?? scheduler?.blocked_count)}
        />
        <SchedulerMetric
          detail={`失败 Pipeline ${failedCount}`}
          icon="lucide:history"
          label="累计完成任务"
          value={metricValue(completedTaskCount)}
        />
      </div>

      <Surface className="flex min-w-0 flex-col gap-2 rounded-lg p-3" variant="secondary">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-muted">
              <Icon className="size-3.5" icon="lucide:gauge" />
            </span>
            <div className="min-w-0">
              <div className="text-xs text-muted">背压</div>
              <div className="text-base font-semibold leading-none tabular-nums text-foreground">{formatPercent(pressure)}</div>
            </div>
          </div>
          <Chip color={pressureColor(pressure)} size="sm" variant="soft">
            {pressure >= 0.85 ? '偏高' : pressure >= 0.6 ? '升高' : '正常'}
          </Chip>
        </div>
        <div className="flex flex-wrap gap-1">
          {(scheduler?.pressure_breakdown ?? []).slice(0, 3).map(([name, value]) => (
            <Chip key={name} size="sm" variant="soft">
              {name}
              {' '}
              <span className="tabular-nums">{formatPercent(value)}</span>
            </Chip>
          ))}
        </div>
      </Surface>
    </Surface>
  )
}

function NewTaskMenu({
  onCreateSubtitle,
  onScanGenerate,
  onTranslate,
}: {
  onCreateSubtitle: () => void
  onScanGenerate: () => void
  onTranslate: () => void
}) {
  return (
    <Dropdown>
      <Button aria-label="新建任务" size="sm" variant="secondary">
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
  )
}

function PipelineProgress({
  percent,
  status,
}: {
  percent: number | null
  status: string
}) {
  if (percent == null) {
    return (
      <div className="min-w-32">
        <div className="mb-1 text-right text-xs tabular-nums text-muted">-</div>
        <ProgressBar aria-label="任务进度" color="default" size="sm" value={0}>
          <ProgressBar.Track>
            <ProgressBar.Fill />
          </ProgressBar.Track>
        </ProgressBar>
      </div>
    )
  }

  return (
    <div className="min-w-32">
      <div className="mb-1 text-right text-xs tabular-nums text-muted">{formatPercent(percent)}</div>
      <ProgressBar
        aria-label="任务进度"
        color={status === 'completed' ? 'success' : FAILED_STATUSES.has(status) ? 'danger' : 'accent'}
        size="sm"
        value={percentValue(percent)}
      >
        <ProgressBar.Track>
          <ProgressBar.Fill />
        </ProgressBar.Track>
      </ProgressBar>
    </div>
  )
}

function PipelineRow({
  actionPending,
  pipeline,
  onCancel,
  onDelete,
  onOpen,
  onPause,
  onResume,
}: {
  actionPending: boolean
  pipeline: PipelineView
  onCancel: (pipeline: PipelineView) => void
  onDelete: (pipeline: PipelineView) => void
  onOpen: (pipeline: PipelineView) => void
  onPause: (pipeline: PipelineView) => void
  onResume: (pipeline: PipelineView) => void
}) {
  const stages = stageJobs(pipeline)
  const currentStage = stages.find(job => ACTIVE_STATUSES.has(job.status)) ?? stages.at(-1) ?? pipeline.root
  const title = pipelineTitle(pipeline)
  const latestSummary = latestLineOf(currentStage)?.summary ?? latestLineOf(pipeline.root)?.summary
  const cancellableJob = cancellableJobOf(pipeline)
  const pausableJob = pausableJobOf(pipeline)
  const resumableJob = resumableJobOf(pipeline)
  const historyRecordId = historyRecordIdOf(pipeline)
  const canDelete = historyRecordId != null

  return (
    <ListView.Item
      id={pipeline.root.identityKey}
      key={pipeline.root.identityKey}
      textValue={title}
      className="py-2"
    >
      <ListView.ItemContent className="min-w-0 flex-1 basis-0 items-center">
        <div className="grid min-w-0 flex-1 gap-3 xl:grid-cols-[minmax(16rem,1fr)_minmax(9rem,14rem)_minmax(8rem,10rem)_minmax(10rem,14rem)] xl:items-center">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <StatusChip task={{ ...pipeline.root, status: pipeline.status, percent: pipeline.percent }} />
              <button
                className="min-w-0 flex-1 truncate text-left text-sm font-medium text-accent"
                title={title}
                type="button"
                onClick={() => onOpen(pipeline)}
              >
                {title}
              </button>
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted">
                #
                {pipeline.root.taskId}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span className="max-w-48 truncate">{transJobType(pipeline.root.taskType)}</span>
              <span className="tabular-nums">
                {pipeline.jobs.length}
                {' '}
                jobs
              </span>
              <TaskDurationMeta task={pipeline.root} />
            </div>
          </div>

          <div className="min-w-0 text-xs text-muted">
            <div className="flex items-center gap-1.5">
              <Icon className="size-3.5" icon="lucide:workflow" />
              <span className="truncate text-foreground">{stageName(currentStage)}</span>
            </div>
            <div className="mt-1 truncate" title={latestSummary}>
              {latestSummary ?? groupLabel(pipelineLaneKey(pipeline))}
            </div>
          </div>

          <PipelineProgress percent={pipeline.percent} status={pipeline.status} />

          <div className="min-w-0 text-xs text-muted xl:text-right">
            <div className="tabular-nums">{formatTaskmillTime(pipeline.latestAt)}</div>
            <div className="mt-1 truncate">
              {groupLabel(pipelineLaneKey(pipeline))}
            </div>
          </div>
        </div>
      </ListView.ItemContent>
      <ListView.ItemAction aria-label="任务操作栏">
        <Dropdown>
          <Tooltip delay={0}>
            <Button
              isIconOnly
              aria-label="任务操作"
              isDisabled={actionPending}
              isPending={actionPending}
              size="sm"
              variant="tertiary"
              onClick={event => event.stopPropagation()}
            >
              <Icon className="size-4" icon="lucide:ellipsis" />
            </Button>
            <Tooltip.Content>任务操作</Tooltip.Content>
          </Tooltip>
          <Dropdown.Popover>
            <Dropdown.Menu
              disabledKeys={[
                !cancellableJob ? 'cancel' : null,
                !pausableJob ? 'pause' : null,
                !resumableJob ? 'resume' : null,
                !canDelete ? 'delete' : null,
              ].filter((key): key is string => key != null)}
              onAction={(key) => {
                if (key === 'cancel') {
                  onCancel(pipeline)
                }
                else if (key === 'pause') {
                  onPause(pipeline)
                }
                else if (key === 'resume') {
                  onResume(pipeline)
                }
                else if (key === 'delete') {
                  onDelete(pipeline)
                }
              }}
            >
              <Dropdown.Item id="cancel" textValue="取消任务">
                <Icon className="size-4 text-muted" icon="lucide:ban" />
                <Label>取消任务</Label>
              </Dropdown.Item>
              <Dropdown.Item id="pause" textValue="暂停任务">
                <Icon className="size-4 text-muted" icon="lucide:pause" />
                <Label>暂停任务</Label>
              </Dropdown.Item>
              <Dropdown.Item id="resume" textValue="恢复任务">
                <Icon className="size-4 text-muted" icon="lucide:play" />
                <Label>恢复任务</Label>
              </Dropdown.Item>
              <Dropdown.Item id="delete" textValue="删除任务记录" variant="danger">
                <Icon className="size-4 text-danger" icon="lucide:trash-2" />
                <Label>删除记录</Label>
              </Dropdown.Item>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </ListView.ItemAction>
    </ListView.Item>
  )
}

function PipelineList({
  actionPending,
  emptyText,
  items,
  loading,
  selectedKeys,
  selectionMode = 'none',
  onCancel,
  onDelete,
  onOpen,
  onPause,
  onResume,
  onSelectionChange,
}: PipelineListProps) {
  return (
    <ListView
      aria-label="Taskmill Pipeline 列表"
      className="min-h-full"
      items={items}
      selectedKeys={selectedKeys}
      selectionMode={selectionMode}
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
            : emptyText}
        </div>
      )}
      onAction={(key) => {
        const pipeline = items.find(item => item.root.identityKey === String(key))
        if (pipeline) {
          onOpen(pipeline)
        }
      }}
      onSelectionChange={onSelectionChange}
    >
      {pipeline => (
        <PipelineRow
          actionPending={actionPending}
          pipeline={pipeline}
          onCancel={onCancel}
          onDelete={onDelete}
          onOpen={onOpen}
          onPause={onPause}
          onResume={onResume}
        />
      )}
    </ListView>
  )
}

function GroupLaneCard({
  lane,
  onOpen,
}: {
  lane: TaskmillGroupLane
  onOpen: (pipeline: PipelineView) => void
}) {
  const slots = lane.allocatedSlots ?? lane.cap ?? Math.max(lane.running + lane.pending, 1)
  const slotPercent = slots > 0 ? Math.min(100, (lane.running / slots) * 100) : 0

  return (
    <Surface className="flex min-w-0 flex-col gap-4 rounded-lg p-4" variant="secondary">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface text-muted">
              <Icon className="size-4" icon={lane.icon} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{lane.label}</div>
              <div className="truncate text-xs text-muted">{lane.key}</div>
            </div>
          </div>
        </div>
        {lane.pausedTaskCount > 0
          ? (
              <Chip color="warning" size="sm" variant="soft">
                暂停
                {' '}
                {lane.pausedTaskCount}
              </Chip>
            )
          : null}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span>槽位</span>
          <span className="tabular-nums">
            {lane.running}
            /
            {slots}
          </span>
        </div>
        <ProgressBar aria-label={`${lane.label} 槽位占用`} color={slotPercent >= 90 ? 'warning' : 'accent'} size="sm" value={slotPercent}>
          <ProgressBar.Track>
            <ProgressBar.Fill />
          </ProgressBar.Track>
        </ProgressBar>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg bg-surface px-3 py-2">
          <div className="text-muted">运行</div>
          <div className="mt-1 text-base font-semibold tabular-nums text-foreground">{lane.running}</div>
        </div>
        <div className="rounded-lg bg-surface px-3 py-2">
          <div className="text-muted">等待</div>
          <div className="mt-1 text-base font-semibold tabular-nums text-foreground">{lane.pending}</div>
        </div>
        <div className="rounded-lg bg-surface px-3 py-2">
          <div className="text-muted">Pipeline</div>
          <div className="mt-1 text-base font-semibold tabular-nums text-foreground">{lane.pipelines.length}</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {lane.cap != null && (
          <Chip size="sm" variant="soft">
            cap
            {lane.cap}
          </Chip>
        )}
        {lane.minSlots != null && (
          <Chip size="sm" variant="soft">
            min
            {lane.minSlots}
          </Chip>
        )}
        {lane.weight != null && (
          <Chip size="sm" variant="soft">
            weight
            {lane.weight}
          </Chip>
        )}
        {lane.rateLimit && (
          <Chip size="sm" variant="soft">
            tokens
            {' '}
            <span className="tabular-nums">{Math.round(lane.rateLimit.availableTokens)}</span>
          </Chip>
        )}
      </div>

      <div className="min-h-16">
        {lane.pipelines.length === 0
          ? <div className="py-3 text-sm text-muted">当前无活跃 Pipeline</div>
          : (
              <div className="flex flex-col gap-2">
                {lane.pipelines.slice(0, 3).map((pipeline) => {
                  const title = pipelineTitle(pipeline)
                  return (
                    <button
                      key={pipeline.root.identityKey}
                      className="flex min-w-0 items-center gap-2 rounded-lg bg-surface px-3 py-2 text-left"
                      type="button"
                      onClick={() => onOpen(pipeline)}
                    >
                      <StatusChip task={{ ...pipeline.root, status: pipeline.status, percent: pipeline.percent }} />
                      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{title}</span>
                      <span className="text-xs tabular-nums text-muted">{pipeline.percent == null ? '-' : formatPercent(pipeline.percent)}</span>
                    </button>
                  )
                })}
              </div>
            )}
      </div>
    </Surface>
  )
}

export function TaskmillExecLogPanel({
  items,
  activeItems,
  historyItems,
  historyHasMore = false,
  historyLoadingMore = false,
  progressItems,
  snapshot,
  loading,
  onQueueChanged,
  onCreateSubtitle,
  onHistoryLoadMore,
  onScanGenerate,
  onTranslate,
}: TaskmillExecLogPanelProps) {
  const message = useAppToast()
  const confirm = useConfirmDialog()
  const [viewMode, setViewMode] = useState<TaskmillViewMode>('queue')
  const [filter, setFilter] = useState<PipelineFilter>('all')
  const [q, setQ] = useState('')
  const [queuePage, setQueuePage] = useState(1)
  const [historyPage, setHistoryPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(PIPELINE_PAGE_SIZE_OPTIONS[0])
  const [detailPipelineKey, setDetailPipelineKey] = useState<string | null>(null)
  const [selectedJobKey, setSelectedJobKey] = useState<string | null>(null)
  const [selectedPipelineKeys, setSelectedPipelineKeys] = useState<Selection>(() => new Set())

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
  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      const results = await Promise.all(ids.map(id => deleteHistoryJobs(id)))
      return results.filter(result => result.deleted).length
    },
    onSuccess: (deletedCount) => {
      if (deletedCount > 0) {
        message.success(`已删除 ${deletedCount} 条任务记录`)
      }
      else {
        message.warning('未找到可删除的任务记录')
      }
      setSelectedPipelineKeys(new Set())
      onQueueChanged()
    },
    onError: (e) => {
      message.error((e as Error).message || '批量删除失败')
    },
  })
  const pauseMutation = useMutation({
    mutationFn: (id: number) => pauseTaskJobs(id),
    onSuccess: () => {
      message.success('已暂停任务')
      onQueueChanged()
    },
    onError: (e) => {
      message.error((e as Error).message || '暂停失败')
    },
  })
  const resumeMutation = useMutation({
    mutationFn: (id: number) => resumeTaskJobs(id),
    onSuccess: () => {
      message.success('已恢复任务')
      onQueueChanged()
    },
    onError: (e) => {
      message.error((e as Error).message || '恢复失败')
    },
  })
  const actionPending = cancelMutation.isPending
    || deleteMutation.isPending
    || bulkDeleteMutation.isPending
    || pauseMutation.isPending
    || resumeMutation.isPending

  const groups = useMemo(
    () => buildTaskLogGroups(items, activeItems, historyItems, progressItems),
    [activeItems, historyItems, items, progressItems],
  )
  const pipelines = useMemo(() => buildPipelineViews(groups), [groups])
  const keyword = q.trim().toLowerCase()
  const activePipelines = useMemo(
    () => pipelines.filter(pipeline => ACTIVE_STATUSES.has(pipeline.status) && pipelineMatchesKeyword(pipeline, keyword)),
    [keyword, pipelines],
  )
  const historyPipelines = useMemo(
    () => pipelines.filter(pipeline => !ACTIVE_STATUSES.has(pipeline.status) && matchesFilter(pipeline, filter) && pipelineMatchesKeyword(pipeline, keyword)),
    [filter, keyword, pipelines],
  )
  const groupLanes = useMemo(
    () => buildTaskmillGroupLanes(snapshot, activeItems, pipelines),
    [activeItems, pipelines, snapshot],
  )
  const queuePageState = useMemo(
    () => pagePipelines(activePipelines, queuePage, pageSize),
    [activePipelines, pageSize, queuePage],
  )
  const historyPageState = useMemo(
    () => pagePipelines(historyPipelines, historyPage, pageSize, historyHasMore),
    [historyHasMore, historyPage, historyPipelines, pageSize],
  )
  const selectedPipelines = useMemo(() => {
    return selectedPipelineKeys === 'all'
      ? historyPageState.rows
      : historyPipelines.filter(pipeline => selectedPipelineKeys.has(pipeline.root.identityKey))
  }, [historyPageState.rows, historyPipelines, selectedPipelineKeys])
  const selectedPipelineCount = selectedPipelines.length
  const selectedHistoryIds = useMemo(() => {
    return selectedPipelines
      .map(pipeline => historyRecordIdOf(pipeline))
      .filter((id): id is number => id != null)
  }, [selectedPipelines])
  const selectedHistoryCount = selectedHistoryIds.length

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

  function confirmPausePipeline(pipeline: PipelineView) {
    const job = pausableJobOf(pipeline)
    if (!job) {
      return
    }

    confirm({
      title: '暂停此任务？',
      description: `将暂停任务 #${job.taskId}，它会留在队列中，稍后可手动恢复。`,
      confirmText: '暂停任务',
      onConfirm: () => pauseMutation.mutateAsync(job.taskId),
    })
  }

  function resumePipeline(pipeline: PipelineView) {
    const job = resumableJobOf(pipeline)
    if (!job) {
      return
    }
    resumeMutation.mutate(job.taskId)
  }

  function confirmDeletePipeline(pipeline: PipelineView) {
    const historyRecordId = historyRecordIdOf(pipeline)
    if (historyRecordId == null) {
      return
    }

    confirm({
      title: '删除此任务记录？',
      description: `将删除历史记录 #${historyRecordId}，此操作不可恢复。`,
      confirmText: '删除',
      danger: true,
      onConfirm: () => deleteMutation.mutateAsync(historyRecordId),
    })
  }

  function confirmDeleteSelectedPipelines() {
    const ids = [...new Set(selectedHistoryIds)]
    if (ids.length === 0) {
      return
    }

    confirm({
      title: '删除选中的任务记录？',
      description: `将删除 ${ids.length} 条历史任务记录，此操作不可恢复。`,
      confirmText: '批量删除',
      danger: true,
      onConfirm: () => bulkDeleteMutation.mutateAsync(ids),
    })
  }

  const allHistoryPipelines = useMemo(
    () => pipelines.filter(pipeline => !ACTIVE_STATUSES.has(pipeline.status) && pipelineMatchesKeyword(pipeline, keyword)),
    [keyword, pipelines],
  )
  const filterCounts: Record<PipelineFilter, number> = {
    all: allHistoryPipelines.length,
    active: activePipelines.length,
    finished: allHistoryPipelines.filter(pipeline => pipeline.status === 'completed').length,
    failed: allHistoryPipelines.filter(pipeline => FAILED_STATUSES.has(pipeline.status)).length,
  }
  const filterTabs: { key: PipelineFilter, label: string }[] = [
    { key: 'all', label: '全部历史' },
    { key: 'finished', label: '已完成' },
    { key: 'failed', label: '失败' },
  ]

  const activeCount = pipelines.filter(pipeline => ACTIVE_STATUSES.has(pipeline.status)).length
  const failedCount = pipelines.filter(pipeline => FAILED_STATUSES.has(pipeline.status)).length
  const completedTaskCount = Number(snapshot?.metrics?.completed ?? 0)

  useEffect(() => {
    if (viewMode !== 'history' || !historyHasMore || historyLoadingMore || historyPage <= historyPageState.loadedPages) {
      return
    }
    void onHistoryLoadMore?.()
  }, [historyHasMore, historyLoadingMore, historyPage, historyPageState.loadedPages, onHistoryLoadMore, viewMode])

  return (
    <>
      <div className="flex min-h-0 w-full flex-1 flex-col gap-4">
        <SchedulerOverview
          activeCount={activeCount}
          completedTaskCount={completedTaskCount}
          failedCount={failedCount}
          snapshot={snapshot}
          onQueueChanged={onQueueChanged}
        />

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <Tabs
              selectedKey={viewMode}
              variant="secondary"
              onSelectionChange={(key: Key) => setViewMode(String(key) as TaskmillViewMode)}
            >
              <Tabs.ListContainer>
                <Tabs.List aria-label="任务管理视图">
                  <Tabs.Tab id="queue">
                    队列
                    <Chip className="ml-2" size="sm" variant="soft">{activePipelines.length}</Chip>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="groups" className="w-64">
                    资源组
                    <Chip className="ml-2" size="sm" variant="soft">{groupLanes.length}</Chip>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                  <Tabs.Tab id="history">
                    历史
                    <Chip className="ml-2" size="sm" variant="soft">{filterCounts.all}</Chip>
                    <Tabs.Indicator />
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>
            </Tabs>

            <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row lg:max-w-2xl">
              {viewMode === 'history' && (
                <Select
                  aria-label="历史状态筛选"
                  className="w-full sm:w-40 sm:shrink-0"
                  value={filter}
                  variant="secondary"
                  onChange={(value) => {
                    if (typeof value !== 'string') {
                      return
                    }
                    setFilter(value as PipelineFilter)
                    setHistoryPage(1)
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
              )}
              <div className="relative min-w-0 flex-1">
                <Icon className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted" icon="lucide:search" />
                <Input
                  className="w-full pl-9"
                  value={q}
                  placeholder="搜索任务"
                  variant="secondary"
                  onChange={(event) => {
                    setQ(event.target.value)
                    setQueuePage(1)
                    setHistoryPage(1)
                  }}
                />
              </div>
              <NewTaskMenu
                onCreateSubtitle={onCreateSubtitle}
                onScanGenerate={onScanGenerate}
                onTranslate={onTranslate}
              />
            </div>
          </div>

          {viewMode === 'queue' && (
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3">
              <div className="min-h-0 overflow-y-auto">
                <PipelineList
                  actionPending={actionPending}
                  emptyText="暂无活跃 Pipeline；提交任务并恢复调度后会显示执行过程。"
                  items={queuePageState.rows}
                  loading={loading}
                  onCancel={confirmCancelPipeline}
                  onDelete={confirmDeletePipeline}
                  onOpen={openPipelineDetail}
                  onPause={confirmPausePipeline}
                  onResume={resumePipeline}
                />
              </div>
              <BasePagination
                showSizeChanger
                className="w-full shrink-0 text-sm text-muted"
                current={queuePageState.currentPage}
                pageSize={pageSize}
                pageSizeOptions={PIPELINE_PAGE_SIZE_OPTIONS}
                size="small"
                total={queuePageState.totalPages * pageSize}
                showTotal={() => (
                  <>
                    显示
                    {' '}
                    {queuePageState.pageStart}
                    -
                    {queuePageState.pageEnd}
                    {' '}
                    / 共
                    {' '}
                    {queuePageState.total}
                    {' '}
                    个 Pipeline
                  </>
                )}
                onChange={(nextPage, nextPageSize) => {
                  if (nextPageSize !== pageSize) {
                    setPageSize(nextPageSize)
                    setQueuePage(1)
                    setHistoryPage(1)
                    return
                  }
                  setQueuePage(nextPage)
                }}
              />
            </div>
          )}

          {viewMode === 'groups' && (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                {groupLanes.map(lane => (
                  <GroupLaneCard
                    key={lane.key}
                    lane={lane}
                    onOpen={openPipelineDetail}
                  />
                ))}
              </div>
            </div>
          )}

          {viewMode === 'history' && (
            <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_auto] gap-3">
              <div className="min-h-0 overflow-y-auto">
                <PipelineList
                  actionPending={actionPending}
                  emptyText="暂无历史任务记录"
                  items={historyPageState.rows}
                  loading={loading || historyLoadingMore}
                  selectedKeys={selectedPipelineKeys}
                  selectionMode="multiple"
                  onCancel={confirmCancelPipeline}
                  onDelete={confirmDeletePipeline}
                  onOpen={openPipelineDetail}
                  onPause={confirmPausePipeline}
                  onResume={resumePipeline}
                  onSelectionChange={setSelectedPipelineKeys}
                />
              </div>
              <BasePagination
                showSizeChanger
                className="w-full shrink-0 text-sm text-muted"
                current={historyPageState.currentPage}
                disabled={historyLoadingMore}
                pageSize={pageSize}
                pageSizeOptions={PIPELINE_PAGE_SIZE_OPTIONS}
                size="small"
                total={historyPageState.totalPages * pageSize}
                showTotal={() => (
                  <>
                    显示
                    {' '}
                    {historyPageState.pageStart}
                    -
                    {historyPageState.pageEnd}
                    {' '}
                    / 共
                    {' '}
                    {historyPageState.total}
                    {historyHasMore ? '+' : ''}
                    {' '}
                    个 Pipeline
                  </>
                )}
                onChange={(nextPage, nextPageSize) => {
                  if (nextPageSize !== pageSize) {
                    setPageSize(nextPageSize)
                    setQueuePage(1)
                    setHistoryPage(1)
                    return
                  }
                  setHistoryPage(nextPage)
                }}
              />
            </div>
          )}
        </div>

        <ActionBar aria-label="批量任务操作" isOpen={viewMode === 'history' && selectedPipelineCount > 0}>
          <ActionBar.Prefix>
            <Chip className="shrink-0 tabular-nums" size="sm">
              已选
              {' '}
              {selectedPipelineCount}
            </Chip>
          </ActionBar.Prefix>
          <Separator />
          <ActionBar.Content>
            <Button
              aria-label="批量删除任务记录"
              className="bg-danger/10 text-danger"
              isDisabled={selectedHistoryCount === 0 || actionPending}
              isPending={bulkDeleteMutation.isPending}
              size="sm"
              variant="ghost"
              onPress={confirmDeleteSelectedPipelines}
            >
              <Icon className="size-4" icon="lucide:trash-2" />
              <span className="action-bar__label">删除</span>
            </Button>
          </ActionBar.Content>
          <Separator />
          <ActionBar.Suffix>
            <Tooltip delay={0}>
              <Button
                isIconOnly
                aria-label="清空选择"
                isDisabled={actionPending}
                size="sm"
                variant="ghost"
                onPress={() => setSelectedPipelineKeys(new Set())}
              >
                <Icon className="size-4" icon="lucide:x" />
              </Button>
              <Tooltip.Content>清空选择</Tooltip.Content>
            </Tooltip>
          </ActionBar.Suffix>
        </ActionBar>
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
