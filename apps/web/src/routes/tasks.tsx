import type {
  TaskmillExecLogEntry,
  TaskmillJobSnapshot,
  TaskmillTaskHistoryRecord,
  TaskmillTaskRecord,
} from '@/api'
import { Button, Chip, Label, Switch } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
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
import { TaskmillExecLogPanel } from '@/components/taskmill-demo-exec-log-panel'
import { TaskmillQueueControls } from '@/components/taskmill-queue-controls'

const historyQueryParams = { limit: 100, offset: 0 } as const
const execLogQueryParams = { limit: 250 } as const
const activeQueryParams = { limit: 200 } as const

export const Route = createFileRoute('/tasks')({
  component: PageComponent,
})

function PageComponent() {
  const message = useAppToast()
  const [createOpen, setCreateOpen] = useState(false)
  const [scanGenerateOpen, setScanGenerateOpen] = useState(false)
  const [translateOpen, setTranslateOpen] = useState(false)
  const [execLogAutoRefresh, setExecLogAutoRefresh] = useState(true)

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

  const runningCount = snapshotQuery.data?.scheduler.running.length ?? 0
  const pendingCount = snapshotQuery.data?.scheduler.pending_count ?? 0
  const activeCount = activeQuery.data?.length ?? 0
  const completedCount = snapshotQuery.data?.metrics.completed ?? 0
  const failedCount = snapshotQuery.data?.metrics.failed ?? 0

  function refreshAll() {
    void snapshotQuery.refetch()
    void activeQuery.refetch()
    void historyQuery.refetch()
    void execLogQuery.refetch()
  }

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

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-secondary px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <h2 className="m-0 text-lg font-semibold">执行过程</h2>
            <p className="m-0 mt-1 text-sm text-muted">
              以 pipeline 列表查看任务状态、阶段和执行日志。
            </p>
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
            <Chip color={completedCount > 0 ? 'success' : 'default'} size="sm" variant="soft">
              已完成
              {completedCount}
            </Chip>
            <Chip color={failedCount > 0 ? 'danger' : 'default'} size="sm" variant="soft">
              失败
              {failedCount}
            </Chip>
            {snapshotQuery.data?.scheduler.is_paused
              ? <Chip color="danger" size="sm" variant="soft">调度已暂停</Chip>
              : null}
            <Switch isSelected={execLogAutoRefresh} onChange={setExecLogAutoRefresh}>
              <Switch.Control>
                <Switch.Thumb />
              </Switch.Control>
              <Switch.Content>
                <Label className="text-sm">自动刷新</Label>
              </Switch.Content>
            </Switch>
          </div>
        </div>

        <TaskmillExecLogPanel
          items={execLogQuery.data}
          activeItems={activeQuery.data}
          historyItems={historyQuery.data}
          loading={execLogQuery.isLoading || execLogQuery.isFetching}
        />
      </div>
    </AppPage>
  )
}
