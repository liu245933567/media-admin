import { PageContainer } from '@ant-design/pro-components'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { App, Button, Card, Space, Switch, Tabs, Tag } from 'antd'
import { useMemo, useState } from 'react'
import { SubtitleTaskCreateDrawerForm } from '@/components/subtitle-task-create-drawer-form'
import { SubtitleTranslateTaskCreateDrawerForm } from '@/components/subtitle-translate-task-create-drawer-form'
import { TaskmillExecLogPanel } from '@/components/taskmill-demo-exec-log-panel'
import { TaskmillHistoryPanel } from '@/components/taskmill-demo-history-panel'
import { TaskmillSnapshotPanel } from '@/components/taskmill-demo-snapshot-panel'
import {
  fetchTaskmillExecLog,
  fetchTaskmillHistory,
  fetchTaskmillSnapshot,
  taskmillExecLogQueryKey,
  taskmillHistoryQueryKey,
  taskmillSnapshotQueryKey,
} from '@/request'

const historyQueryParams = { limit: 100, offset: 0 } as const
const execLogQueryParams = { limit: 250 } as const

export const Route = createFileRoute('/subtitle-task')({
  component: PageComponent,
})

function PageComponent() {
  const { message } = App.useApp()
  const [createOpen, setCreateOpen] = useState(false)
  const [translateOpen, setTranslateOpen] = useState(false)
  const [execLogAutoRefresh, setExecLogAutoRefresh] = useState(true)
  const [taskTypeFilter, setTaskTypeFilter] = useState<string | undefined>()

  const snapshotQuery = useQuery({
    queryKey: taskmillSnapshotQueryKey,
    queryFn: fetchTaskmillSnapshot,
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

  const runningCount = snapshotQuery.data?.scheduler.running.length ?? 0
  const pendingCount = snapshotQuery.data?.scheduler.pending_count ?? 0

  function refreshAll() {
    void snapshotQuery.refetch()
    void historyQuery.refetch()
    void execLogQuery.refetch()
  }

  return (
    <PageContainer
      title="字幕任务"
      subTitle="基于 Taskmill 调度：视频识别生成 SRT，并按配置链式入队翻译。"
    >
      <div className="flex flex-col gap-4">
        <Space wrap>
          <Button type="primary" onClick={() => setCreateOpen(true)}>
            新增生成任务
          </Button>
          <Button onClick={() => setTranslateOpen(true)}>
            仅翻译字幕
          </Button>
          <Button loading={snapshotQuery.isFetching} onClick={refreshAll}>
            刷新
          </Button>
          <Tag color={runningCount > 0 ? 'processing' : 'default'}>
            执行中
            {' '}
            {runningCount}
          </Tag>
          <Tag color={pendingCount > 0 ? 'warning' : 'default'}>
            排队
            {' '}
            {pendingCount}
          </Tag>
        </Space>

        <SubtitleTaskCreateDrawerForm
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={() => {
            message.success('已提交字幕生成任务')
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
          items={[
            {
              key: 'history',
              label: '任务历史',
              children: (
                <Card variant="borderless" className="shadow-sm">
                  <Space className="mb-3" wrap>
                    <span className="text-sm text-neutral-500">任务类型</span>
                    <Button
                      size="small"
                      type={taskTypeFilter === undefined ? 'primary' : 'default'}
                      onClick={() => setTaskTypeFilter(undefined)}
                    >
                      全部
                    </Button>
                    <Button
                      size="small"
                      type={taskTypeFilter === 'video-subtitle-generate' ? 'primary' : 'default'}
                      onClick={() => setTaskTypeFilter('video-subtitle-generate')}
                    >
                      生成
                    </Button>
                    <Button
                      size="small"
                      type={taskTypeFilter === 'extract-wav' ? 'primary' : 'default'}
                      onClick={() => setTaskTypeFilter('extract-wav')}
                    >
                      提取 WAV
                    </Button>
                    <Button
                      size="small"
                      type={taskTypeFilter === 'whisper-vad-srt' ? 'primary' : 'default'}
                      onClick={() => setTaskTypeFilter('whisper-vad-srt')}
                    >
                      识别字幕
                    </Button>
                    <Button
                      size="small"
                      type={taskTypeFilter === 'subtitle-translate' ? 'primary' : 'default'}
                      onClick={() => setTaskTypeFilter('subtitle-translate')}
                    >
                      翻译
                    </Button>
                  </Space>
                  <TaskmillHistoryPanel
                    items={filteredHistory}
                    loading={historyQuery.isLoading || historyQuery.isFetching}
                  />
                </Card>
              ),
            },
            {
              key: 'exec-log',
              label: '执行日志',
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
            {
              key: 'snapshot',
              label: '调度快照',
              children: (
                <Card variant="borderless" className="shadow-sm">
                  <TaskmillSnapshotPanel
                    data={snapshotQuery.data}
                    loading={snapshotQuery.isLoading || snapshotQuery.isFetching}
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
