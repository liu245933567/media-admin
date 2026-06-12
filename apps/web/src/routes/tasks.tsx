import type {
  TaskmillExecLogEntry,
  TaskmillJobSnapshot,
  TaskmillTaskHistoryRecord,
  TaskmillTaskRecord,
} from '@/api'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
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
import { ScanGenerateSubtitleDrawerForm } from '@/features/subtitles/scan-generate-subtitle-drawer-form'
import { SubtitleTaskCreateDrawerForm } from '@/features/subtitles/subtitle-task-create-drawer-form'
import { SubtitleTranslateTaskCreateDrawerForm } from '@/features/subtitles/subtitle-translate-task-create-drawer-form'
import { TaskmillExecLogPanel } from '@/features/taskmill/taskmill-exec-log-panel'

const activeQueryParams = { limit: 200 } as const
const execLogQueryParams = { limit: 250 } as const
const historyPageSize = 100

export const Route = createFileRoute('/tasks')({
  component: PageComponent,
})

function PageComponent() {
  const message = useAppToast()
  const [createOpen, setCreateOpen] = useState(false)
  const [scanGenerateOpen, setScanGenerateOpen] = useState(false)
  const [translateOpen, setTranslateOpen] = useState(false)

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

  const historyQuery = useInfiniteQuery({
    queryKey: getHistoryJobsQueryKey({ limit: historyPageSize }),
    queryFn: ({ pageParam }) => historyJobs({
      limit: historyPageSize,
      offset: pageParam,
    }) as Promise<TaskmillTaskHistoryRecord[]>,
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length >= historyPageSize
        ? allPages.length * historyPageSize
        : undefined
    },
    refetchInterval: 5000,
  })
  const historyItems = historyQuery.data?.pages.flat() ?? []

  const execLogQuery = useQuery({
    queryKey: getExecLogJobsQueryKey(execLogQueryParams),
    queryFn: () => execLogJobs(execLogQueryParams) as Promise<TaskmillExecLogEntry[]>,
    refetchInterval: 1200,
  })

  function refreshAll() {
    void snapshotQuery.refetch()
    void activeQuery.refetch()
    void historyQuery.refetch()
    void execLogQuery.refetch()
  }

  return (
    <div className="flex h-[calc(100dvh-4rem)] min-h-0 flex-col">
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
        historyItems={historyItems}
        historyHasMore={historyQuery.hasNextPage}
        historyLoadingMore={historyQuery.isFetchingNextPage}
        progressItems={snapshotQuery.data?.scheduler.progress}
        snapshot={snapshotQuery.data}
        loading={execLogQuery.isLoading || execLogQuery.isFetching}
        onQueueChanged={refreshAll}
        onCreateSubtitle={() => setCreateOpen(true)}
        onHistoryLoadMore={() => historyQuery.fetchNextPage()}
        onScanGenerate={() => setScanGenerateOpen(true)}
        onTranslate={() => setTranslateOpen(true)}
      />
    </div>
  )
}
