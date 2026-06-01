import type { ColumnsType } from 'antd/es/table'
import type {
  TaskmillHistoryStatus,
  TaskmillTaskHistoryRecord,
} from '@/api'
import { useMutation } from '@tanstack/react-query'
import { App, Button, Popconfirm, Table, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import duration from 'dayjs/plugin/duration'
import { useMemo } from 'react'
import { deleteHistoryJobs } from '@/api'
import { formatTaskmillTime } from '@/lib/taskmill-time'
import { transJobType, transStatus } from './taskmill-active-tasks-panel'

dayjs.extend(duration)

function historyStatusColor(s: TaskmillHistoryStatus): string {
  const map: Record<TaskmillHistoryStatus, string> = {
    completed: 'success',
    failed: 'error',
    cancelled: 'default',
    superseded: 'processing',
    expired: 'warning',
    dependency_failed: 'orange',
    dead_letter: 'magenta',
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
  const { message } = App.useApp()

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

  const columns: ColumnsType<TaskmillTaskHistoryRecord> = useMemo(
    () => [
      { title: 'ID', dataIndex: 'id', fixed: 'left' },
      {
        title: '类型',
        dataIndex: 'task_type',
        ellipsis: true,
        render: (t: string) => (
          <Typography.Text ellipsis={{ tooltip: t }} className="max-w-[200px]">
            {transJobType(t)}
          </Typography.Text>
        ),
      },
      {
        title: '标签',
        dataIndex: 'label',
        ellipsis: true,
        render: (t: string) => (
          <Typography.Text ellipsis={{ tooltip: t }} className="max-w-[240px]">
            {t}
          </Typography.Text>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        render: (s: TaskmillHistoryStatus) => (
          <Tag color={historyStatusColor(s)}>{transStatus(s)}</Tag>
        ),
      },
      {
        title: '完成时间',
        dataIndex: 'completed_at',
        width: 170,
        render: (t: string) => formatTaskmillTime(t),
      },
      {
        title: '耗时 (ms)',
        dataIndex: 'duration_ms',
        render: (v: number | null) => (v == null ? '—' : dayjs.duration(v).humanize()),
      },
      {
        title: '错误',
        dataIndex: 'last_error',
        ellipsis: true,
        render: (t: string | null) =>
          t
            ? (
                <Typography.Text type="danger" ellipsis={{ tooltip: t }} className="max-w-[200px]">
                  {t}
                </Typography.Text>
              )
            : (
                <Typography.Text type="secondary">—</Typography.Text>
              ),
      },
      {
        title: '操作',
        key: 'action',
        width: 100,
        fixed: 'right' as const,
        render: (_: unknown, row: TaskmillTaskHistoryRecord) => (
          <Popconfirm
            title="删除此历史记录？"
            description="仅从数据库移除记录，不可恢复。"
            onConfirm={() => deleteMutation.mutate(row.id)}
          >
            <Button
              type="link"
              size="small"
              danger
              disabled={deleteMutation.isPending}
            >
              删除
            </Button>
          </Popconfirm>
        ),
      },
    ],
    [deleteMutation],
  )

  return (
    <Table<TaskmillTaskHistoryRecord>
      size="small"
      rowKey="id"
      loading={loading}
      columns={columns}
      dataSource={items}
    />
  )
}
