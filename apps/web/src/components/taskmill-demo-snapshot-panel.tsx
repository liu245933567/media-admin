import type { ColumnsType } from 'antd/es/table'
import type {
  TaskmillJobSnapshot,
  TaskmillSerdeDuration,
  TaskmillTaskProgress,
  TaskmillTaskRecord,
  TaskmillTaskStatus,
} from '@/types/taskmill-snapshot'
import { useMutation } from '@tanstack/react-query'
import {
  App,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Empty,
  Popconfirm,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd'
import { useMemo } from 'react'
import { cancelTaskmillTask } from '@/request'

function formatDuration(d: TaskmillSerdeDuration | null | undefined): string {
  if (!d)
    return '—'
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
  const { message } = App.useApp()

  const cancelMutation = useMutation({
    mutationFn: cancelTaskmillTask,
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

  const runningColumns: ColumnsType<TaskmillTaskRecord> = useMemo(() => {
    if (!data)
      return []
    const { progress, byte_progress: byteProgress } = data.scheduler

    return [
      {
        title: 'ID',
        dataIndex: 'id',
        width: 72,
        fixed: 'left' as const,
      },
      {
        title: '类型',
        dataIndex: 'task_type',
        width: 200,
        ellipsis: true,
        render: (t: string) => (
          <Typography.Text ellipsis={{ tooltip: t }} className="max-w-[180px]">
            {t}
          </Typography.Text>
        ),
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
          <Tag color={statusColor(s)}>{s}</Tag>
        ),
      },
      {
        title: '优先级',
        dataIndex: 'priority',
        width: 88,
      },
      {
        title: '进度',
        key: 'prog',
        width: 140,
        render: (_: unknown, row: TaskmillTaskRecord) => {
          const ep = progress.find(p => p.header.task_id === row.id)
          if (ep) {
            return (
              <Progress
                percent={Math.round(ep.percent * 1000) / 10}
                size="small"
                status="active"
              />
            )
          }
          const bp = byteProgress.find(p => p.task_id === row.id)
          if (bp?.bytes_total) {
            const pct = Math.min(
              100,
              Math.round((bp.bytes_completed / bp.bytes_total) * 1000) / 10,
            )
            return <Progress percent={pct} size="small" />
          }
          return <Typography.Text type="secondary">—</Typography.Text>
        },
      },
      {
        title: '操作',
        key: 'action',
        width: 88,
        fixed: 'right' as const,
        render: (_: unknown, row: TaskmillTaskRecord) => (
          <Popconfirm
            title="取消此任务？"
            onConfirm={() => cancelMutation.mutate(row.id)}
          >
            <Button
              type="link"
              size="small"
              danger
              disabled={cancelMutation.isPending}
            >
              取消
            </Button>
          </Popconfirm>
        ),
      },
    ]
  }, [data, cancelMutation])

  if (loading && !data) {
    return <Typography.Paragraph type="secondary">加载中…</Typography.Paragraph>
  }

  if (!data) {
    return <Empty description="暂无快照数据" />
  }

  const { scheduler, metrics } = data

  return (
    <Space direction="vertical" size="large" className="w-full">
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} md={6}>
          <Card size="small" className="h-full shadow-sm">
            <Statistic title="运行中" value={metrics.running} suffix={`/ ${metrics.max_concurrency}`} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small" className="h-full shadow-sm">
            <Statistic title="等待调度" value={metrics.pending} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small" className="h-full shadow-sm">
            <Statistic title="已完成" value={metrics.completed} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small" className="h-full shadow-sm">
            <Statistic
              title="失败"
              value={metrics.failed}
              valueStyle={{ color: metrics.failed ? '#cf1322' : undefined }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small" className="h-full shadow-sm">
            <Statistic title="已入队" value={metrics.submitted} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small" className="h-full shadow-sm">
            <Statistic title="已派发" value={metrics.dispatched} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small" className="h-full shadow-sm">
            <Statistic title="阻塞" value={metrics.blocked} />
          </Card>
        </Col>
        <Col xs={12} sm={8} md={6}>
          <Card size="small" className="h-full shadow-sm">
            <Statistic title="背压" value={metrics.pressure} precision={2} />
          </Card>
        </Col>
      </Row>

      <Card size="small" title="调度器背压" className="shadow-sm">
        <Space direction="vertical" className="w-full" size="middle">
          <div>
            <Typography.Text type="secondary" className="text-xs">
              综合
            </Typography.Text>
            <Progress
              percent={Math.round(scheduler.pressure * 1000) / 10}
              status={scheduler.pressure > 0.85 ? 'exception' : 'active'}
            />
          </div>
          {scheduler.pressure_breakdown.length > 0 && (
            <div className="flex flex-col gap-2">
              <Typography.Text type="secondary" className="text-xs">
                按来源
              </Typography.Text>
              {scheduler.pressure_breakdown.map(([name, v]) => (
                <div key={name} className="flex items-center gap-3">
                  <Typography.Text className="w-40 shrink-0 truncate text-xs" title={name}>
                    {name}
                  </Typography.Text>
                  <Progress
                    className="min-w-0 flex-1"
                    percent={Math.round(v * 1000) / 10}
                    size="small"
                  />
                </div>
              ))}
            </div>
          )}
        </Space>
      </Card>

      <Descriptions
        bordered
        size="small"
        column={{ xs: 1, sm: 2, md: 3 }}
        title="队列概览"
      >
        <Descriptions.Item label="pending">{scheduler.pending_count}</Descriptions.Item>
        <Descriptions.Item label="paused">{scheduler.paused_count}</Descriptions.Item>
        <Descriptions.Item label="waiting">{scheduler.waiting_count}</Descriptions.Item>
        <Descriptions.Item label="blocked">{scheduler.blocked_count}</Descriptions.Item>
        <Descriptions.Item label="max_concurrency">{scheduler.max_concurrency}</Descriptions.Item>
        <Descriptions.Item label="全局暂停">
          {scheduler.is_paused ? <Tag color="red">是</Tag> : <Tag>否</Tag>}
        </Descriptions.Item>
      </Descriptions>

      <div>
        <Typography.Title level={5} className="mb-2 mt-0">
          运行中任务
        </Typography.Title>
        <Table<TaskmillTaskRecord>
          size="small"
          rowKey="id"
          loading={loading}
          pagination={false}
          scroll={{ x: 900 }}
          dataSource={scheduler.running}
          columns={runningColumns}
          locale={{ emptyText: '当前无运行中任务' }}
        />
      </div>

      {scheduler.byte_progress.length > 0 && (
        <div>
          <Typography.Title level={5} className="mb-2 mt-0">
            字节进度
          </Typography.Title>
          <Table<TaskmillTaskProgress>
            size="small"
            rowKey="task_id"
            pagination={false}
            scroll={{ x: 800 }}
            dataSource={scheduler.byte_progress}
            columns={[
              { title: '任务', dataIndex: 'task_id', width: 72 },
              {
                title: '标签',
                dataIndex: 'label',
                ellipsis: true,
                render: (t: string) => (
                  <Typography.Text ellipsis={{ tooltip: t }} className="max-w-[200px]">
                    {t}
                  </Typography.Text>
                ),
              },
              {
                title: '字节',
                key: 'bytes',
                render: (_: unknown, r: TaskmillTaskProgress) => {
                  const total = r.bytes_total
                  const cur = r.bytes_completed
                  if (total) {
                    return `${cur} / ${total}`
                  }
                  return String(cur)
                },
              },
              {
                title: '吞吐 (B/s)',
                dataIndex: 'throughput_bps',
                width: 120,
                render: (v: number) => v.toFixed(0),
              },
              {
                title: '已耗时',
                dataIndex: 'elapsed',
                width: 100,
                render: (e: TaskmillSerdeDuration) => formatDuration(e),
              },
              {
                title: 'ETA',
                dataIndex: 'eta',
                width: 100,
                render: (e: TaskmillSerdeDuration | null) => formatDuration(e ?? undefined),
              },
            ]}
          />
        </div>
      )}

      <Collapse
        size="small"
        items={[
          {
            key: 'raw',
            label: '原始 JSON',
            children: (
              <Typography.Paragraph>
                <pre>
                  {JSON.stringify(data, null, 2)}
                </pre>
              </Typography.Paragraph>

            ),
          },
        ]}
      />
    </Space>
  )
}
