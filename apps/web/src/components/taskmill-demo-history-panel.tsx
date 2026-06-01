import type { ColumnDef } from '@tanstack/react-table'
import type {
  TaskmillHistoryStatus,
  TaskmillTaskHistoryRecord,
} from '@/api'
import { Button, Chip, Tooltip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import relativeTime from 'dayjs/plugin/relativeTime'
import { useMemo } from 'react'
import { deleteHistoryJobs } from '@/api'
import { formatTaskmillTime } from '@/lib/taskmill-time'
import { useAppToast } from './app-toast'
import { useConfirmDialog } from './confirm-dialog'
import { DataTable } from './data-table'
import { transJobType, transStatus } from './taskmill-active-tasks-panel'

dayjs.extend(duration)
dayjs.extend(relativeTime)

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
          <Tooltip>
            <span className="block max-w-[200px] truncate">{transJobType(row.original.task_type)}</span>
            <Tooltip.Content>{row.original.task_type}</Tooltip.Content>
          </Tooltip>
        ),
      },
      {
        header: '标签',
        accessorKey: 'label',
        cell: ({ row }) => (
          <Tooltip>
            <span className="block max-w-[240px] truncate">{row.original.label}</span>
            <Tooltip.Content>{row.original.label}</Tooltip.Content>
          </Tooltip>
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
        cell: ({ row }) => row.original.duration_ms == null ? '-' : dayjs.duration(row.original.duration_ms).humanize(),
      },
      {
        header: '错误',
        accessorKey: 'last_error',
        cell: ({ row }) =>
          row.original.last_error
            ? (
                <Tooltip>
                  <span className="block max-w-[200px] truncate text-danger">{row.original.last_error}</span>
                  <Tooltip.Content>{row.original.last_error}</Tooltip.Content>
                </Tooltip>
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
