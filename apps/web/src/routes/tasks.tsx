import type {
  TaskmillExecLogEntry,
  TaskmillJobSnapshot,
  TaskmillTaskHistoryRecord,
  TaskmillTaskRecord,
} from '@/api'
import { Button, Card, Chip, Label, Switch } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import {
  activeTasksJobs,
  execLogJobs,
  getActiveTasksJobsQueryKey,
  getExecLogJobsQueryKey,
  getHistoryJobsQueryKey,
  getSnapshotJobsQueryKey,
  historyJobs,
  snapshotJobs,
} from '@/api'
import { AppPage } from '@/components/app-page'
import { useAppToast } from '@/components/app-toast'
import { ScanGenerateSubtitleDrawerForm } from '@/components/scan-generate-subtitle-drawer-form'
import { SubtitleTaskCreateDrawerForm } from '@/components/subtitle-task-create-drawer-form'
import { SubtitleTranslateTaskCreateDrawerForm } from '@/components/subtitle-translate-task-create-drawer-form'
import { TaskmillActiveTasksPanel } from '@/components/taskmill-active-tasks-panel'
import { TaskmillExecLogPanel } from '@/components/taskmill-demo-exec-log-panel'
import { TaskmillHistoryPanel } from '@/components/taskmill-demo-history-panel'
import { TaskmillSnapshotPanel } from '@/components/taskmill-demo-snapshot-panel'
import { TaskmillQueueControls } from '@/components/taskmill-queue-controls'

const historyQueryParams = { limit: 100, offset: 0 } as const
const execLogQueryParams = { limit: 250 } as const
const activeQueryParams = { limit: 200 } as const

type TaskTab = 'snapshot' | 'active' | 'history' | 'exec-log'

export const Route = createFileRoute('/tasks')({
  component: PageComponent,
})

function PageComponent() {
  const message = useAppToast()
  const [createOpen, setCreateOpen] = useState(false)
  const [scanGenerateOpen, setScanGenerateOpen] = useState(false)
  const [translateOpen, setTranslateOpen] = useState(false)
  const [execLogAutoRefresh, setExecLogAutoRefresh] = useState(true)
  const [taskTypeFilter] = useState<string | undefined>()
  const [activeTab, setActiveTab] = useState<TaskTab>('snapshot')

  const snapshotQuery = useQuery({
    queryKey: getSnapshotJobsQueryKey(),
    queryFn: () => snapshotJobs() as Promise<TaskmillJobSnapshot>,
    refetchInterval: 3000,
  })

  const activeQuery = useQuery({
    queryKey: getActiveTasksJobsQueryKey(activeQueryParams),
    queryFn: () => activeTasksJobs(activeQueryParams) as Promise<TaskmillTaskRecord[]>,
    refetchInterval: 3000,
  })

  const historyQuery = useQuery({
    queryKey: getHistoryJobsQueryKey(historyQueryParams),
    queryFn: () => historyJobs(historyQueryParams) as Promise<TaskmillTaskHistoryRecord[]>,
    refetchInterval: 5000,
  })

  const execLogQuery = useQuery({
    queryKey: getExecLogJobsQueryKey(execLogQueryParams),
    queryFn: () => execLogJobs(execLogQueryParams) as Promise<TaskmillExecLogEntry[]>,
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

  const tabs: { key: TaskTab, label: string }[] = [
    { key: 'snapshot', label: '队列与执行中' },
    { key: 'active', label: '活跃任务' },
    { key: 'history', label: '任务历史' },
    { key: 'exec-log', label: '调度事件' },
  ]

  return (
    <AppPage
      title="任务管理"
      extra={(
        <div className="flex flex-wrap items-center gap-2">
          <TaskmillQueueControls onChanged={refreshAll} />
          <Button onPress={() => setCreateOpen(true)}>
            <Icon className="size-4" icon="lucide:plus" />
            字幕生成
          </Button>
          <Button variant="secondary" onPress={() => setScanGenerateOpen(true)}>
            扫描并生成
          </Button>
          <Button variant="secondary" onPress={() => setTranslateOpen(true)}>
            字幕翻译
          </Button>
        </div>
      )}
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

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {tabs.map(tab => (
              <Button
                key={tab.key}
                size="sm"
                variant={activeTab === tab.key ? 'primary' : 'tertiary'}
                onPress={() => setActiveTab(tab.key)}
              >
                {tab.label}
              </Button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip color={runningCount > 0 ? 'accent' : 'default'} size="sm" variant="soft">
              执行中
              {runningCount}
            </Chip>
            <Chip color={pendingCount > 0 ? 'warning' : 'default'} size="sm" variant="soft">
              排队
              {pendingCount}
            </Chip>
            <Chip color={activeCount > 0 ? 'accent' : 'default'} size="sm" variant="soft">
              活跃
              {activeCount}
            </Chip>
            {snapshotQuery.data?.scheduler.is_paused
              ? <Chip color="danger" size="sm" variant="soft">调度已暂停</Chip>
              : null}
          </div>
        </div>

        {activeTab === 'snapshot'
          ? (
              <Card>
                <Card.Content>
                  <TaskmillSnapshotPanel
                    data={snapshotQuery.data}
                    loading={snapshotQuery.isLoading || snapshotQuery.isFetching}
                    onChanged={refreshAll}
                  />
                </Card.Content>
              </Card>
            )
          : null}

        {activeTab === 'active'
          ? (
              <TaskmillActiveTasksPanel
                items={filteredActive}
                loading={activeQuery.isLoading || activeQuery.isFetching}
                onChanged={refreshAll}
              />
            )
          : null}

        {activeTab === 'history'
          ? (
              <TaskmillHistoryPanel
                items={filteredHistory}
                loading={historyQuery.isLoading || historyQuery.isFetching}
                onChanged={refreshAll}
              />
            )
          : null}

        {activeTab === 'exec-log'
          ? (
              <Card>
                <Card.Header className="items-center justify-between">
                  <Card.Title>调度事件</Card.Title>
                  <Switch isSelected={execLogAutoRefresh} onChange={setExecLogAutoRefresh}>
                    <Switch.Control>
                      <Switch.Thumb />
                    </Switch.Control>
                    <Switch.Content>
                      <Label className="text-sm">自动刷新</Label>
                    </Switch.Content>
                  </Switch>
                </Card.Header>
                <Card.Content>
                  <TaskmillExecLogPanel
                    items={execLogQuery.data}
                    loading={execLogQuery.isLoading || execLogQuery.isFetching}
                  />
                </Card.Content>
              </Card>
            )
          : null}
      </div>
    </AppPage>
  )
}
