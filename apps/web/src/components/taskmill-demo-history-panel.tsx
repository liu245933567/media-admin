import type { ColumnsType } from 'antd/es/table'
import type {
  TaskmillHistoryStatus,
  TaskmillTaskHistoryRecord,
} from '@/types'
import { Segmented, Space, Table, Tag, Typography } from 'antd'
import { useMemo, useState } from 'react'

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

type HistoryViewFilter = 'completed' | 'all'

export interface TaskmillDemoHistoryPanelProps {
  items: TaskmillTaskHistoryRecord[] | undefined
  loading?: boolean
}

export function TaskmillDemoHistoryPanel({
  items,
  loading,
}: TaskmillDemoHistoryPanelProps) {
  const [filter, setFilter] = useState<HistoryViewFilter>('completed')

  const filtered = useMemo(() => {
    const list = items ?? []
    if (filter === 'completed') {
      return list.filter(r => r.status === 'completed')
    }
    return list
  }, [items, filter])

  const columns: ColumnsType<TaskmillTaskHistoryRecord> = useMemo(
    () => [
      { title: 'ID', dataIndex: 'id', width: 72, fixed: 'left' },
      {
        title: '类型',
        dataIndex: 'task_type',
        width: 220,
        ellipsis: true,
        render: (t: string) => (
          <Typography.Text ellipsis={{ tooltip: t }} className="max-w-[200px]">
            {t}
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
        width: 130,
        render: (s: TaskmillHistoryStatus) => (
          <Tag color={historyStatusColor(s)}>{s}</Tag>
        ),
      },
      {
        title: '完成时间',
        dataIndex: 'completed_at',
        width: 200,
        render: (t: string) => t.replace('T', ' ').replace(/\.\d+Z?$/, ''),
      },
      {
        title: '耗时 (ms)',
        dataIndex: 'duration_ms',
        width: 110,
        render: (v: number | null) => (v == null ? '—' : String(v)),
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
    ],
    [],
  )

  return (
    <Space direction="vertical" size="middle" className="w-full">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Segmented<HistoryViewFilter>
          value={filter}
          onChange={v => setFilter(v as HistoryViewFilter)}
          options={[
            { label: '已完成', value: 'completed' },
            { label: '全部终态', value: 'all' },
          ]}
        />
        <Typography.Text type="secondary" className="text-xs">
          展示最近 100 条历史；「已完成」为本地筛选。刷新快照时会同步刷新本表。
        </Typography.Text>
      </div>
      <Table<TaskmillTaskHistoryRecord>
        size="small"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={filtered}
        scroll={{ x: 1100 }}
        pagination={{ pageSize: 10, showSizeChanger: true, pageSizeOptions: [10, 20, 50] }}
        locale={{
          emptyText:
            filter === 'completed'
              ? '暂无已成功完成的任务（可切换到「全部终态」查看失败/取消等）'
              : '暂无历史记录',
        }}
      />
    </Space>
  )
}
