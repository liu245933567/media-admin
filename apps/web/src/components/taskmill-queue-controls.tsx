import type { TaskmillJobSnapshot } from '@/api'
import { PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button } from 'antd'
import {
  getActiveTasksJobsQueryKey,
  getSnapshotJobsQueryKey,
  pauseSchedulerJobs,
  resumeSchedulerJobs,
  snapshotJobs,
} from '@/api'

const taskmillSnapshotQueryKey = getSnapshotJobsQueryKey()

export interface TaskmillQueueControlsProps {
  onChanged?: () => void
}

export function TaskmillQueueControls({ onChanged }: TaskmillQueueControlsProps) {
  const { message } = App.useApp()
  const queryClient = useQueryClient()

  const snapshotQuery = useQuery({
    queryKey: taskmillSnapshotQueryKey,
    queryFn: () => snapshotJobs() as Promise<TaskmillJobSnapshot>,
    refetchInterval: 2000,
  })

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: taskmillSnapshotQueryKey })
    void queryClient.invalidateQueries({ queryKey: getActiveTasksJobsQueryKey() })
    onChanged?.()
  }

  const pauseMutation = useMutation({
    mutationFn: () => pauseSchedulerJobs(),
    onSuccess: () => {
      message.success('已暂停任务调度：运行中任务将暂停，不再派发新任务')
      invalidate()
    },
    onError: (e) => {
      message.error((e as Error).message || '暂停失败')
    },
  })

  const resumeMutation = useMutation({
    mutationFn: () => resumeSchedulerJobs(),
    onSuccess: () => {
      message.success('任务调度已恢复')
      invalidate()
    },
    onError: (e) => {
      message.error((e as Error).message || '恢复失败')
    },
  })

  const isPaused = snapshotQuery.data?.scheduler.is_paused ?? false

  return (
    <>
      {isPaused
        ? (
            <Button
              icon={<PlayCircleOutlined />}
              loading={resumeMutation.isPending}
              onClick={() => resumeMutation.mutate()}
            >
              恢复任务调度
            </Button>
          )
        : (
            <Button
              icon={<PauseCircleOutlined />}
              loading={pauseMutation.isPending}
              onClick={() => pauseMutation.mutate()}
            >
              暂停任务调度
            </Button>
          )}
    </>
  )
}
