import { PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { useMutation, useQuery } from '@tanstack/react-query'
import { App, Button } from 'antd'

export interface QueueControlsProps {
  onChanged?: () => void
  /** React Query 缓存键，例如 ['subtitle-task-queue-status'] */
  statusQueryKey: readonly string[]
  fetchQueueStatus: () => Promise<{ status: string }>
  pauseQueue: () => Promise<unknown>
  resumeQueue: () => Promise<unknown>
}

type QueueStatus = 'RUNNING' | 'PAUSING' | 'PAUSED' | 'UNKNOWN'

export function QueueControls(props: QueueControlsProps) {
  const { message } = App.useApp()

  const queueStatusQuery = useQuery({
    queryKey: props.statusQueryKey,
    queryFn: async () => {
      const res = await props.fetchQueueStatus()
      return (res.status ?? 'UNKNOWN') as QueueStatus
    },
    refetchInterval: 2000,
  })

  const pauseMutation = useMutation({
    mutationFn: () => props.pauseQueue(),
    onSuccess: () => {
      message.success('已请求暂停任务队列：将等待当前任务执行完成后暂停')
      queueStatusQuery.refetch()
      props.onChanged?.()
    },
    onError: (e) => {
      message.error((e as Error).message || '暂停失败')
    },
  })

  const resumeMutation = useMutation({
    mutationFn: () => props.resumeQueue(),
    onSuccess: () => {
      message.success('任务队列已开始')
      queueStatusQuery.refetch()
      props.onChanged?.()
    },
    onError: (e) => {
      message.error((e as Error).message || '开始失败')
    },
  })

  const status = queueStatusQuery.data ?? 'UNKNOWN'
  const pausingOrLoading = status === 'PAUSING' || pauseMutation.isPending

  return (
    <>
      {(status === 'PAUSED') && (
        <Button
          key="start"
          icon={<PlayCircleOutlined />}
          loading={resumeMutation.isPending}
          onClick={() => resumeMutation.mutate()}
        >
          开始任务队列
        </Button>
      )}

      {(status === 'RUNNING' || status === 'PAUSING' || status === 'UNKNOWN') && (
        <Button
          key="pause"
          icon={<PauseCircleOutlined />}
          loading={pausingOrLoading}
          disabled={status === 'PAUSING' || pauseMutation.isPending || queueStatusQuery.isFetching}
          onClick={() => pauseMutation.mutate()}
        >
          暂停任务队列
        </Button>
      )}
    </>
  )
}
