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
  'media-jobs::video-subtitle-extract-wav': '提取音频',
  'media-jobs::video-subtitle-recognize': '识别字幕',
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

export interface TaskmillTaskTreeRow<T extends { id: number, parent_id: number | null }> {
  item: T
  depth: number
}

export function flattenTaskTree<T extends { id: number, parent_id: number | null }>(
  items: T[] | undefined,
): Array<TaskmillTaskTreeRow<T>> {
  const source = items ?? []
  const childrenByParent = new Map<number | null, T[]>()
  const byId = new Map<number, T>()

  for (const item of source) {
    byId.set(item.id, item)
  }

  const createsParentCycle = (item: T): boolean => {
    const seen = new Set<number>([item.id])
    let parentId = item.parent_id
    while (parentId != null) {
      if (seen.has(parentId)) {
        return true
      }
      seen.add(parentId)
      parentId = byId.get(parentId)?.parent_id ?? null
    }
    return false
  }

  for (const item of source) {
    const parentId = item.parent_id != null && byId.has(item.parent_id) && !createsParentCycle(item)
      ? item.parent_id
      : null
    const children = childrenByParent.get(parentId) ?? []
    children.push(item)
    childrenByParent.set(parentId, children)
  }

  const rows: Array<TaskmillTaskTreeRow<T>> = []
  const visited = new Set<number>()
  const visit = (task: T, depth: number) => {
    if (visited.has(task.id)) {
      return
    }
    visited.add(task.id)
    rows.push({ item: task, depth })
    for (const child of childrenByParent.get(task.id) ?? []) {
      visit(child, depth + 1)
    }
  }

  for (const root of childrenByParent.get(null) ?? []) {
    visit(root, 0)
  }

  return rows
}

export function TaskHierarchyLabel({ depth }: { depth: number }) {
  if (depth <= 0) {
    return null
  }

  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center text-muted"
      style={{ width: depth * 18 }}
    >
      <span className="ml-auto mr-1 h-px w-3 bg-divider" />
    </span>
  )
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
  const treeRows = useMemo(() => flattenTaskTree(items), [items])

  const columns: ColumnDef<TaskmillTaskTreeRow<TaskmillTaskRecord>, unknown>[] = useMemo(
    () => [
      { header: 'ID', accessorFn: row => row.item.id, size: 72 },
      {
        header: '类型',
        accessorFn: row => row.item.task_type,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center">
            <TaskHierarchyLabel depth={row.original.depth} />
            <TooltipText className="max-w-45 truncate" content={row.original.item.task_type}>
              {transJobType(row.original.item.task_type)}
            </TooltipText>
          </div>
        ),
      },
      {
        header: '标签',
        accessorFn: row => row.item.label,
        cell: ({ row }) => (
          <TooltipText className="max-w-55 truncate" content={row.original.item.label}>
            {row.original.item.label}
          </TooltipText>
        ),
      },
      {
        header: '状态',
        accessorFn: row => row.item.status,
        cell: ({ row }) => (
          <Chip color={statusColor(row.original.item.status)} size="sm" variant="soft">
            {transStatus(row.original.item.status)}
          </Chip>
        ),
      },
      {
        header: '操作',
        id: 'action',
        enableSorting: false,
        cell: ({ row }) => {
          const task = row.original.item
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
    [actionPending, cancelMutation, confirm, pauseMutation, resumeMutation],
  )

  return (
    <DataTable
      ariaLabel="活跃任务"
      loading={loading}
      columns={columns}
      data={treeRows}
      emptyText="当前无活跃任务"
      getRowId={row => String(row.item.id)}
      minWidth={820}
    />
  )
}
