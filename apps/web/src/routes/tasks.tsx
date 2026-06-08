import type {
  TaskmillExecLogEntry,
  TaskmillJobSnapshot,
  TaskmillTaskHistoryRecord,
  TaskmillTaskRecord,
} from '@/api'
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
import { useAppToast } from '@/components/app-toast'
import { ScanGenerateSubtitleDrawerForm } from '@/components/scan-generate-subtitle-drawer-form'
import { SubtitleTaskCreateDrawerForm } from '@/components/subtitle-task-create-drawer-form'
import { SubtitleTranslateTaskCreateDrawerForm } from '@/components/subtitle-translate-task-create-drawer-form'
import { TaskmillExecLogPanel } from '@/components/taskmill-exec-log-panel'

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
    <div className="flex flex-col gap-3">
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

      <TaskmillExecLogPanel
        items={execLogQuery.data}
        activeItems={activeQuery.data}
        historyItems={historyQuery.data}
        progressItems={snapshotQuery.data?.scheduler.progress}
        loading={execLogQuery.isLoading || execLogQuery.isFetching}
        runningCount={runningCount}
        pendingCount={pendingCount}
        activeCount={activeCount}
        completedCount={completedCount}
        failedCount={failedCount}
        isSchedulerPaused={snapshotQuery.data?.scheduler.is_paused ?? false}
        execLogAutoRefresh={execLogAutoRefresh}
        onExecLogAutoRefreshChange={setExecLogAutoRefresh}
        onQueueChanged={refreshAll}
        onCreateSubtitle={() => setCreateOpen(true)}
        onScanGenerate={() => setScanGenerateOpen(true)}
        onTranslate={() => setTranslateOpen(true)}
      />
    </div>
  )
}
