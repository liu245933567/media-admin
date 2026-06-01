import type { ColumnsType } from 'antd/es/table'
import type { TaskmillTaskRecord, TaskmillTaskStatus } from '@/api'
import { useMutation } from '@tanstack/react-query'
import { App, Button, Popconfirm, Space, Table, Tag, Typography } from 'antd'
import { useMemo } from 'react'
import {
  cancelTaskJobs,
  pauseTaskJobs,
  resumeTaskJobs,
} from '@/api'

function statusColor(status: TaskmillTaskStatus): string {
  const map: Record<TaskmillTaskStatus, string> = {
    running: 'processing',
    pending: 'default',
    paused: 'warning',
    waiting: 'blue',
    blocked: 'orange',
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
  const { message } = App.useApp()

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

  const columns: ColumnsType<TaskmillTaskRecord> = useMemo(
    () => [
      { title: 'ID', dataIndex: 'id', width: 72, fixed: 'left' },
      {
        title: '类型',
        dataIndex: 'task_type',
        width: 200,
        ellipsis: true,
        render: (t: string) => (
          <Typography.Text ellipsis={{ tooltip: t }} className="max-w-[180px]">
            {transJobType(t)}
          </Typography.Text>
        ),
        filters: Object.entries(JOB_TYPE_LABELS).map(([key, value]) => ({
          text: value,
          value: key,
        })),
        onFilter: (value, record) => record.task_type === value,
      },
      {
        title: '标签',
        dataIndex: 'label',
        ellipsis: true,
        render: (t: string) => (
          <Typography.Text ellipsis={{ tooltip: t }} className="max-w-[220px]">
            {t}
          </Typography.Text>
        ),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 96,
        render: (s: TaskmillTaskStatus) => (
          <Tag color={statusColor(s)}>{transStatus(s)}</Tag>
        ),
      },
      {
        title: '操作',
        key: 'action',
        width: 200,
        fixed: 'right',
        render: (_, row) => {
          const cancelBtn = (
            <Popconfirm
              title="取消此任务？"
              description="运行中的任务将停止并记入历史。"
              onConfirm={() => cancelMutation.mutate(row.id)}
            >
              <Button type="link" size="small" danger disabled={actionPending}>
                取消
              </Button>
            </Popconfirm>
          )

          if (row.status === 'running' || row.status === 'waiting') {
            return cancelBtn
          }
          if (row.status === 'paused') {
            return (
              <Space size="small">
                <Button
                  type="link"
                  size="small"
                  disabled={actionPending}
                  loading={resumeMutation.isPending}
                  onClick={() => resumeMutation.mutate(row.id)}
                >
                  恢复
                </Button>
                {cancelBtn}
              </Space>
            )
          }
          if (row.status === 'pending' || row.status === 'blocked') {
            return (
              <Space size="small">
                <Button
                  type="link"
                  size="small"
                  disabled={actionPending}
                  loading={pauseMutation.isPending}
                  onClick={() => pauseMutation.mutate(row.id)}
                >
                  暂停
                </Button>
                {cancelBtn}
              </Space>
            )
          }
          return null
        },
      },
    ],
    [actionPending, cancelMutation, pauseMutation, resumeMutation],
  )

  return (
    <Table<TaskmillTaskRecord>
      size="small"
      rowKey="id"
      loading={loading}
      columns={columns}
      dataSource={items ?? []}
      pagination={{ showSizeChanger: true }}
      locale={{ emptyText: '当前无活跃任务' }}
    />
  )
}
