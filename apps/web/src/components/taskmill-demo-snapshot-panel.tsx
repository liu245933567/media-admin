import type { ColumnDef } from '@tanstack/react-table'
import type {
  TaskmillJobSnapshot,
  TaskmillSerdeDuration,
  TaskmillTaskProgress,
  TaskmillTaskRecord,
  TaskmillTaskStatus,
} from '@/api'
import { Button, Card, Chip, ProgressBar, Spinner, Tooltip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'
import { cancelTaskJobs } from '@/api'
import { useAppToast } from './app-toast'
import { useConfirmDialog } from './confirm-dialog'
import { DataTable } from './data-table'
import { transStatus } from './taskmill-active-tasks-panel'

function formatDuration(d: TaskmillSerdeDuration | null | undefined): string {
  if (!d)
    return '-'
  const totalMs = d.secs * 1000 + Math.floor(d.nanos / 1_000_000)
  if (totalMs < 1000)
    return `${totalMs} ms`
  const s = totalMs / 1000
  if (s < 60)
    return `${s.toFixed(1)} s`
  const m = Math.floor(s / 60)
  const rs = s - m * 60
  return `${m}m ${rs.toFixed(0)}s`
}

function statusColor(status: TaskmillTaskStatus): 'default' | 'accent' | 'success' | 'warning' | 'danger' {
  const map: Record<TaskmillTaskStatus, 'default' | 'accent' | 'success' | 'warning' | 'danger'> = {
    running: 'success',
    pending: 'default',
    paused: 'warning',
    waiting: 'accent',
    blocked: 'warning',
  }
  return map[status]
}

function PercentBar({
  ariaLabel,
  value,
  color = 'accent',
}: {
  ariaLabel: string
  value: number
  color?: 'default' | 'accent' | 'success' | 'warning' | 'danger'
}) {
  return (
    <ProgressBar aria-label={ariaLabel} color={color} size="sm" value={value}>
      <ProgressBar.Track>
        <ProgressBar.Fill />
      </ProgressBar.Track>
    </ProgressBar>
  )
}

function StatCard({
  title,
  value,
  danger,
}: {
  title: string
  value: React.ReactNode
  danger?: boolean
}) {
  return (
    <Card className="h-full">
      <Card.Content className="p-4">
        <div className="text-xs text-muted">{title}</div>
        <div className={danger ? 'mt-1 text-2xl font-semibold tabular-nums text-danger' : 'mt-1 text-2xl font-semibold tabular-nums'}>
          {value}
        </div>
      </Card.Content>
    </Card>
  )
}

export interface TaskmillSnapshotPanelProps {
  data: TaskmillJobSnapshot | undefined
  loading?: boolean
  onChanged?: () => void
}

export function TaskmillSnapshotPanel({
  data,
  loading,
  onChanged,
}: TaskmillSnapshotPanelProps) {
  const message = useAppToast()
  const confirm = useConfirmDialog()

  const cancelMutation = useMutation({
    mutationFn: (id: number) => cancelTaskJobs(id),
    onSuccess: (res) => {
      if (res.cancelled) {
        message.success('已取消任务')
      }
      else {
        message.warning('未找到可取消的任务')
      }
      onChanged?.()
    },
    onError: (e) => {
      message.error((e as Error).message || '取消失败')
    },
  })

  const runningColumns: ColumnDef<TaskmillTaskRecord, unknown>[] = useMemo(() => {
    if (!data)
      return []
    const { progress, byte_progress: byteProgress } = data.scheduler

    return [
      { header: 'ID', accessorKey: 'id' },
      {
        header: '类型',
        accessorKey: 'task_type',
        cell: ({ row }) => (
          <Tooltip>
            <span className="block max-w-[180px] truncate">{row.original.task_type}</span>
            <Tooltip.Content>{row.original.task_type}</Tooltip.Content>
          </Tooltip>
        ),
      },
      {
        header: '标签',
        accessorKey: 'label',
        cell: ({ row }) => (
          <Tooltip>
            <span className="block max-w-[220px] truncate">{row.original.label}</span>
            <Tooltip.Content>{row.original.label}</Tooltip.Content>
          </Tooltip>
        ),
      },
      {
        header: '状态',
        accessorKey: 'status',
        cell: ({ row }) => (
          <Chip color={statusColor(row.original.status)} size="sm" variant="soft">
            {transStatus(row.original.status)}
          </Chip>
        ),
      },
      { header: '优先级', accessorKey: 'priority' },
      {
        header: '进度',
        id: 'progress',
        enableSorting: false,
        cell: ({ row }) => {
          const ep = progress.find(p => p.header.task_id === row.original.id)
          if (ep) {
            return (
              <div className="min-w-28">
                <PercentBar ariaLabel="任务进度" value={Math.round(ep.percent * 1000) / 10} />
              </div>
            )
          }
          const bp = byteProgress.find(p => p.task_id === row.original.id)
          if (bp?.bytes_total) {
            const pct = Math.min(
              100,
              Math.round((bp.bytes_completed / bp.bytes_total) * 1000) / 10,
            )
            return (
              <div className="min-w-28">
                <PercentBar ariaLabel="字节进度" value={pct} />
              </div>
            )
          }
          return <span className="text-muted">-</span>
        },
      },
      {
        header: '操作',
        id: 'action',
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="danger-soft"
            isDisabled={cancelMutation.isPending}
            onPress={() => confirm({
              title: '取消此任务？',
              confirmText: '取消任务',
              danger: true,
              onConfirm: () => cancelMutation.mutateAsync(row.original.id),
            })}
          >
            取消
          </Button>
        ),
      },
    ]
  }, [cancelMutation, confirm, data])

  const byteColumns: ColumnDef<TaskmillTaskProgress, unknown>[] = useMemo(
    () => [
      { header: '任务', accessorKey: 'task_id' },
      {
        header: '标签',
        accessorKey: 'label',
        cell: ({ row }) => (
          <Tooltip>
            <span className="block max-w-[220px] truncate">{row.original.label}</span>
            <Tooltip.Content>{row.original.label}</Tooltip.Content>
          </Tooltip>
        ),
      },
      {
        header: '字节',
        id: 'bytes',
        cell: ({ row }) => {
          const total = row.original.bytes_total
          const cur = row.original.bytes_completed
          if (total) {
            return `${cur} / ${total}`
          }
          return String(cur)
        },
      },
      {
        header: '吞吐 (B/s)',
        accessorKey: 'throughput_bps',
        cell: ({ row }) => row.original.throughput_bps.toFixed(0),
      },
      {
        header: '已耗时',
        accessorKey: 'elapsed',
        cell: ({ row }) => formatDuration(row.original.elapsed),
      },
      {
        header: 'ETA',
        accessorKey: 'eta',
        cell: ({ row }) => formatDuration(row.original.eta),
      },
    ],
    [],
  )

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted">
        <Spinner size="sm" />
        加载中...
      </div>
    )
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
        暂无快照数据
      </div>
    )
  }

  const { scheduler, metrics } = data

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="运行中" value={`${metrics.running} / ${metrics.max_concurrency}`} />
        <StatCard title="等待调度" value={metrics.pending} />
        <StatCard title="已完成" value={metrics.completed} />
        <StatCard title="失败" value={metrics.failed} danger={metrics.failed > 0} />
        <StatCard title="已入队" value={metrics.submitted} />
        <StatCard title="已派发" value={metrics.dispatched} />
        <StatCard title="阻塞" value={metrics.blocked} />
        <StatCard title="背压" value={metrics.pressure.toFixed(2)} />
      </div>

      <Card>
        <Card.Header>
          <Card.Title>调度器背压</Card.Title>
        </Card.Header>
        <Card.Content className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <div className="text-xs text-muted">综合</div>
            <PercentBar
              ariaLabel="综合背压"
              color={scheduler.pressure > 0.85 ? 'danger' : 'accent'}
              value={Math.round(scheduler.pressure * 1000) / 10}
            />
          </div>
          {scheduler.pressure_breakdown.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="text-xs text-muted">按来源</div>
              {scheduler.pressure_breakdown.map(([name, v]) => (
                <div key={name} className="flex items-center gap-3">
                  <span className="w-40 shrink-0 truncate text-xs" title={name}>
                    {name}
                  </span>
                  <div className="min-w-0 flex-1">
                    <PercentBar ariaLabel={`${name} 背压`} value={Math.round(v * 1000) / 10} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>队列概览</Card.Title>
        </Card.Header>
        <Card.Content>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">pending</dt>
              <dd className="m-0 font-medium tabular-nums">{scheduler.pending_count}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">paused</dt>
              <dd className="m-0 font-medium tabular-nums">{scheduler.paused_count}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">waiting</dt>
              <dd className="m-0 font-medium tabular-nums">{scheduler.waiting_count}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">blocked</dt>
              <dd className="m-0 font-medium tabular-nums">{scheduler.blocked_count}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">max_concurrency</dt>
              <dd className="m-0 font-medium tabular-nums">{scheduler.max_concurrency}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">全局暂停</dt>
              <dd className="m-0">
                {scheduler.is_paused
                  ? <Chip color="danger" size="sm" variant="soft">是</Chip>
                  : <Chip size="sm" variant="soft">否</Chip>}
              </dd>
            </div>
          </dl>
        </Card.Content>
      </Card>

      <section className="flex flex-col gap-3">
        <h3 className="m-0 text-base font-semibold">运行中任务</h3>
        <DataTable
          ariaLabel="运行中任务"
          columns={runningColumns}
          data={scheduler.running}
          emptyText="当前无运行中任务"
          getRowId={row => String(row.id)}
          loading={loading}
          minWidth={860}
          showPagination={false}
        />
      </section>

      {scheduler.byte_progress.length > 0 && (
        <section className="flex flex-col gap-3">
          <h3 className="m-0 text-base font-semibold">字节进度</h3>
          <DataTable
            ariaLabel="字节进度"
            columns={byteColumns}
            data={scheduler.byte_progress}
            getRowId={row => String(row.task_id)}
            minWidth={800}
            showPagination={false}
          />
        </section>
      )}
    </div>
  )
}
