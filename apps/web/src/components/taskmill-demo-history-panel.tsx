import type { ColumnDef } from '@tanstack/react-table'
import type {
  TaskmillHistoryStatus,
  TaskmillTaskHistoryRecord,
} from '@/api'
import { Button, Chip, Popover } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import { useMemo } from 'react'
import { deleteHistoryJobs } from '@/api'
import { formatTaskmillTime } from '@/lib/taskmill-time'
import { useAppToast } from './app-toast'
import { useConfirmDialog } from './confirm-dialog'
import { DataTable } from './data-table'
import { transJobType, transStatus } from './taskmill-active-tasks-panel'

dayjs.extend(duration)

function PopoverText({
  children,
  className,
  content,
}: {
  children: React.ReactNode
  className?: string
  content: React.ReactNode
}) {
  return (
    <Popover>
      <Popover.Trigger className={className}>
        {children}
      </Popover.Trigger>
      <Popover.Content className="max-w-[min(520px,calc(100vw-2rem))]">
        <Popover.Dialog>
          <div className="max-h-80 overflow-auto whitespace-pre-wrap break-all text-sm">
            {content}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

function historyStatusColor(s: TaskmillHistoryStatus): 'default' | 'accent' | 'success' | 'warning' | 'danger' {
  const map: Record<TaskmillHistoryStatus, 'default' | 'accent' | 'success' | 'warning' | 'danger'> = {
    completed: 'success',
    failed: 'danger',
    cancelled: 'default',
    superseded: 'accent',
    expired: 'warning',
    dependency_failed: 'danger',
    dead_letter: 'danger',
  }
  return map[s]
}

function formatDurationMs(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return '-'
  }

  const totalSeconds = Math.ceil(value / 1000)
  if (totalSeconds <= 0) {
    return '0s'
  }

  const d = dayjs.duration(totalSeconds, 'seconds')
  const parts: string[] = []
  const days = Math.floor(d.asDays())

  if (days)
    parts.push(`${days}d`)
  if (d.hours())
    parts.push(`${d.hours()}h`)
  if (d.minutes())
    parts.push(`${d.minutes()}m`)
  if (d.seconds())
    parts.push(`${d.seconds()}s`)

  return parts.join('')
}

export interface TaskmillHistoryPanelProps {
  items: TaskmillTaskHistoryRecord[] | undefined
  loading?: boolean
  onChanged?: () => void
}

export function TaskmillHistoryPanel({
  items,
  loading,
  onChanged,
}: TaskmillHistoryPanelProps) {
  const message = useAppToast()
  const confirm = useConfirmDialog()

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteHistoryJobs(id),
    onSuccess: (res) => {
      if (res.deleted) {
        message.success('已删除历史记录')
      }
      else {
        message.warning('记录不存在或已删除')
      }
      onChanged?.()
    },
    onError: (e) => {
      message.error((e as Error).message || '删除失败')
    },
  })

  const columns: ColumnDef<TaskmillTaskHistoryRecord, unknown>[] = useMemo(
    () => [
      { header: 'ID', accessorKey: 'id' },
      {
        header: '类型',
        accessorKey: 'task_type',
        cell: ({ row }) => (
          <PopoverText className="max-w-[200px] truncate" content={row.original.task_type}>
            {transJobType(row.original.task_type)}
          </PopoverText>
        ),
      },
      {
        header: '标签',
        accessorKey: 'label',
        cell: ({ row }) => (
          <PopoverText className="max-w-60 truncate" content={row.original.label}>
            {row.original.label}
          </PopoverText>
        ),
      },
      {
        header: '状态',
        accessorKey: 'status',
        cell: ({ row }) => (
          <Chip color={historyStatusColor(row.original.status)} size="sm" variant="soft">
            {transStatus(row.original.status)}
          </Chip>
        ),
      },
      {
        header: '完成时间',
        accessorKey: 'completed_at',
        cell: ({ row }) => formatTaskmillTime(row.original.completed_at),
      },
      {
        header: '耗时',
        accessorKey: 'duration_ms',
        cell: ({ row }) => row.original.duration_ms == null ? '-' : formatDurationMs(row.original.duration_ms),
      },
      {
        header: '错误',
        accessorKey: 'last_error',
        cell: ({ row }) =>
          row.original.last_error
            ? (
                <PopoverText className="max-w-50 truncate text-danger" content={row.original.last_error}>
                  {row.original.last_error}
                </PopoverText>
              )
            : (
                <span className="text-muted">-</span>
              ),
      },
      {
        header: '操作',
        id: 'action',
        enableSorting: false,
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="danger-soft"
            isDisabled={deleteMutation.isPending}
            onPress={() => confirm({
              title: '删除此历史记录？',
              description: '仅从数据库移除记录，不可恢复。',
              confirmText: '删除',
              danger: true,
              onConfirm: () => deleteMutation.mutateAsync(row.original.id),
            })}
          >
            删除
          </Button>
        ),
      },
    ],
    [confirm, deleteMutation],
  )

  return (
    <DataTable
      ariaLabel="历史任务"
      loading={loading}
      columns={columns}
      data={items ?? []}
      emptyText="暂无历史记录"
      getRowId={row => String(row.id)}
      minWidth={960}
    />
  )
}
