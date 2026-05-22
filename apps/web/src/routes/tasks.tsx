import { PlusOutlined } from '@ant-design/icons'
import { PageContainer } from '@ant-design/pro-components'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { App, Button, Card, Dropdown, Space, Switch, Tabs, Tag } from 'antd'
import { useMemo, useState } from 'react'
import { ScanGenerateSubtitleDrawerForm } from '@/components/scan-generate-subtitle-drawer-form'
import { SubtitleTaskCreateDrawerForm } from '@/components/subtitle-task-create-drawer-form'
import { SubtitleTranslateTaskCreateDrawerForm } from '@/components/subtitle-translate-task-create-drawer-form'
import { TaskmillActiveTasksPanel } from '@/components/taskmill-active-tasks-panel'
import { TaskmillExecLogPanel } from '@/components/taskmill-demo-exec-log-panel'
import { TaskmillHistoryPanel } from '@/components/taskmill-demo-history-panel'
import { TaskmillSnapshotPanel } from '@/components/taskmill-demo-snapshot-panel'
import { TaskmillQueueControls } from '@/components/taskmill-queue-controls'
import {
  fetchTaskmillActiveTasks,
  fetchTaskmillExecLog,
  fetchTaskmillHistory,
  fetchTaskmillSnapshot,
  taskmillActiveQueryKey,
  taskmillExecLogQueryKey,
  taskmillHistoryQueryKey,
  taskmillSnapshotQueryKey,
} from '@/request'

const historyQueryParams = { limit: 100, offset: 0 } as const
const execLogQueryParams = { limit: 250 } as const
const activeQueryParams = { limit: 200 } as const

export const Route = createFileRoute('/tasks')({
  component: PageComponent,
})

function PageComponent() {
  const { message } = App.useApp()
  const [createOpen, setCreateOpen] = useState(false)
  const [scanGenerateOpen, setScanGenerateOpen] = useState(false)
  const [translateOpen, setTranslateOpen] = useState(false)
  const [execLogAutoRefresh, setExecLogAutoRefresh] = useState(true)
  const [taskTypeFilter] = useState<string | undefined>()

  const snapshotQuery = useQuery({
    queryKey: taskmillSnapshotQueryKey,
    queryFn: fetchTaskmillSnapshot,
    refetchInterval: 3000,
  })

  const activeQuery = useQuery({
    queryKey: taskmillActiveQueryKey(activeQueryParams),
    queryFn: () => fetchTaskmillActiveTasks(activeQueryParams),
    refetchInterval: 3000,
  })

  const historyQuery = useQuery({
    queryKey: taskmillHistoryQueryKey(historyQueryParams),
    queryFn: () => fetchTaskmillHistory(historyQueryParams),
    refetchInterval: 5000,
  })

  const execLogQuery = useQuery({
    queryKey: taskmillExecLogQueryKey(execLogQueryParams),
    queryFn: () => fetchTaskmillExecLog(execLogQueryParams),
    refetchInterval: execLogAutoRefresh ? 1200 : false,
  })

  const filteredHistory = useMemo(() => {
    const list = historyQuery.data ?? []
    if (!taskTypeFilter) {
      return list
    }
    return list.filter(r => r.task_type === taskTypeFilter)
  }, [historyQuery.data, taskTypeFilter])

  const filteredActive = useMemo(() => {
    const list = activeQuery.data ?? []
    if (!taskTypeFilter) {
      return list
    }
    return list.filter(r => r.task_type === taskTypeFilter)
  }, [activeQuery.data, taskTypeFilter])

  const runningCount = snapshotQuery.data?.scheduler.running.length ?? 0
  const pendingCount = snapshotQuery.data?.scheduler.pending_count ?? 0
  const activeCount = activeQuery.data?.length ?? 0

  function refreshAll() {
    void snapshotQuery.refetch()
    void activeQuery.refetch()
    void historyQuery.refetch()
    void execLogQuery.refetch()
  }

  return (
    <PageContainer
      title="任务管理"
      extra={[
        // <Button key="refresh" loading={snapshotQuery.isFetching} onClick={refreshAll}>
        //   刷新
        // </Button>,
        <TaskmillQueueControls key="queue-controls" onChanged={refreshAll} />,
        <Dropdown
          key="dropdown"
          menu={{
            items: [
              {
                key: 'subtitle-generate',
                label: '字幕生成（视频 → SRT）',
                onClick: () => setCreateOpen(true),
              },
              {
                key: 'scan-subtitle-generate',
                label: '扫描并生成字幕',
                onClick: () => setScanGenerateOpen(true),
              },
              {
                key: 'subtitle-translate',
                label: '字幕翻译（SRT）',
                onClick: () => setTranslateOpen(true),
              },
            ],
          }}
        >
          <Button type="primary">
            新建任务
            <PlusOutlined />
          </Button>
        </Dropdown>,
      ]}
    >
      <div className="flex flex-col gap-4">

        <SubtitleTaskCreateDrawerForm
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => {
            message.success('已提交字幕生成任务')
            refreshAll()
          }}
        />
        <ScanGenerateSubtitleDrawerForm
          open={scanGenerateOpen}
          onOpenChange={setScanGenerateOpen}
          onCreated={() => {
            message.success('已提交扫描并生成字幕任务')
            refreshAll()
          }}
        />
        <SubtitleTranslateTaskCreateDrawerForm
          open={translateOpen}
          onOpenChange={setTranslateOpen}
          onCreated={() => {
            message.success('已提交字幕翻译任务')
            refreshAll()
          }}
        />

        <Tabs
          tabBarExtraContent={{
            right: (
              <Space>
                <Tag color={runningCount > 0 ? 'processing' : 'default'}>
                  执行中
                  {runningCount}
                </Tag>
                <Tag color={pendingCount > 0 ? 'warning' : 'default'}>
                  排队
                  {pendingCount}
                </Tag>
                <Tag color={activeCount > 0 ? 'blue' : 'default'}>
                  活跃
                  {activeCount}
                </Tag>
                {snapshotQuery.data?.scheduler.is_paused
                  ? (
                      <Tag color="red">调度已暂停</Tag>
                    )
                  : null}
              </Space>
            ),
          }}
          items={[
            {
              key: 'snapshot',
              label: '队列与执行中',
              children: (
                <Card variant="borderless" className="shadow-sm">
                  <TaskmillSnapshotPanel
                    data={snapshotQuery.data}
                    loading={snapshotQuery.isLoading || snapshotQuery.isFetching}
                    onChanged={refreshAll}
                  />
                </Card>
              ),
            },
            {
              key: 'active',
              label: '活跃任务',
              children: (
                <TaskmillActiveTasksPanel
                  items={filteredActive}
                  loading={activeQuery.isLoading || activeQuery.isFetching}
                  onChanged={refreshAll}
                />
              ),
            },
            {
              key: 'history',
              label: '任务历史',
              children: (
                <TaskmillHistoryPanel
                  items={filteredHistory}
                  loading={historyQuery.isLoading || historyQuery.isFetching}
                  onChanged={refreshAll}
                />
              ),
            },
            {
              key: 'exec-log',
              label: '调度事件',
              children: (
                <Card
                  variant="borderless"
                  className="shadow-sm"
                  extra={(
                    <Switch
                      size="small"
                      checked={execLogAutoRefresh}
                      onChange={setExecLogAutoRefresh}
                      checkedChildren="自动刷新"
                      unCheckedChildren="手动"
                    />
                  )}
                >
                  <TaskmillExecLogPanel
                    items={execLogQuery.data}
                    loading={execLogQuery.isLoading || execLogQuery.isFetching}
                  />
                </Card>
              ),
            },
          ]}
        />
      </div>
    </PageContainer>
  )
}
