import type { ColumnDef } from '@tanstack/react-table'
import type { TaskmillTaskRecord, TaskmillTaskStatus } from '@/api'
import { Button, Chip, Tooltip } from '@heroui/react'
import { useMutation } from '@tanstack/react-query'
import { useMemo } from 'react'
import {
  cancelTaskJobs,
  pauseTaskJobs,
  resumeTaskJobs,
} from '@/api'
import { useAppToast } from './app-toast'
import { useConfirmDialog } from './confirm-dialog'
import { DataTable } from './data-table'

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

export function transStatus(status: string): string {
  const map: Record<string, string> = {
    running: '运行中',
    pending: '等待中',
    paused: '暂停中',
    waiting: '等待中',
    blocked: '阻塞中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
    superseded: '已替换',
    expired: '已过期',
    dependency_failed: '依赖失败',
    dead_letter: '死信',
  }

  return map[status] ?? status
}

const JOB_TYPE_LABELS: Record<string, string> = {
  'media-jobs::media-library-scan': '媒体库扫描',
  'media-jobs::whisper-model-download': '下载 Whisper 模型',
  'media-jobs::ffmpeg-setup-download': '下载 FFmpeg',
  'media-jobs::video-subtitle-generate': '字幕生成',
  'media-jobs::subtitle-translate': '字幕翻译',
}

function TooltipText({
  children,
  className,
  content,
}: {
  children: React.ReactNode
  className?: string
  content: React.ReactNode
}) {
  return (
    <Tooltip delay={0}>
      <Tooltip.Trigger className={className}>
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content>{content}</Tooltip.Content>
    </Tooltip>
  )
}

export function transJobType(type: string): string {
  return JOB_TYPE_LABELS[type] ?? type.split('::').pop() ?? ''
}

export interface TaskmillActiveTasksPanelProps {
  items: TaskmillTaskRecord[] | undefined
  loading?: boolean
  onChanged?: () => void
}

export function TaskmillActiveTasksPanel({
  items,
  loading,
  onChanged,
}: TaskmillActiveTasksPanelProps) {
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

  const pauseMutation = useMutation({
    mutationFn: (id: number) => pauseTaskJobs(id),
    onSuccess: () => {
      message.success('已暂停任务')
      onChanged?.()
    },
    onError: (e) => {
      message.error((e as Error).message || '暂停失败')
    },
  })

  const resumeMutation = useMutation({
    mutationFn: (id: number) => resumeTaskJobs(id),
    onSuccess: () => {
      message.success('已恢复任务')
      onChanged?.()
    },
    onError: (e) => {
      message.error((e as Error).message || '恢复失败')
    },
  })

  const actionPending
    = cancelMutation.isPending || pauseMutation.isPending || resumeMutation.isPending

  const columns: ColumnDef<TaskmillTaskRecord, unknown>[] = useMemo(
    () => [
      { header: 'ID', accessorKey: 'id', size: 72 },
      {
        header: '类型',
        accessorKey: 'task_type',
        cell: ({ row }) => (
          <TooltipText className="max-w-[180px] truncate" content={row.original.task_type}>
            {transJobType(row.original.task_type)}
          </TooltipText>
        ),
      },
      {
        header: '标签',
        accessorKey: 'label',
        cell: ({ row }) => (
          <TooltipText className="max-w-[220px] truncate" content={row.original.label}>
            {row.original.label}
          </TooltipText>
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
      {
        header: '操作',
        id: 'action',
        enableSorting: false,
        cell: ({ row }) => {
          const task = row.original
          const cancelBtn = (
            <Button
              size="sm"
              variant="danger-soft"
              isDisabled={actionPending}
              onPress={() => confirm({
                title: '取消此任务？',
                description: '运行中的任务将停止并记入历史。',
                confirmText: '取消任务',
                danger: true,
                onConfirm: () => cancelMutation.mutateAsync(task.id),
              })}
            >
              取消
            </Button>
          )

          if (task.status === 'running' || task.status === 'waiting') {
            return cancelBtn
          }
          if (task.status === 'paused') {
            return (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="tertiary"
                  isDisabled={actionPending}
                  isPending={resumeMutation.isPending}
                  onPress={() => resumeMutation.mutate(task.id)}
                >
                  恢复
                </Button>
                {cancelBtn}
              </div>
            )
          }
          if (task.status === 'pending' || task.status === 'blocked') {
            return (
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="tertiary"
                  isDisabled={actionPending}
                  isPending={pauseMutation.isPending}
                  onPress={() => pauseMutation.mutate(task.id)}
                >
                  暂停
                </Button>
                {cancelBtn}
              </div>
            )
          }
          return null
        },
      },
    ],
    [actionPending, cancelMutation, pauseMutation, resumeMutation],
  )

  return (
    <DataTable
      ariaLabel="活跃任务"
      loading={loading}
      columns={columns}
      data={items ?? []}
      emptyText="当前无活跃任务"
      getRowId={row => String(row.id)}
      minWidth={820}
    />
  )
}
