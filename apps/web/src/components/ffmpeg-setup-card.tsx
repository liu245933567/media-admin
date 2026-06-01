import type { TaskmillJobSnapshot, TaskmillTaskHistoryRecord, TaskmillTaskRecord } from '@/api'
import type { SetupDownloadUiProgress } from '@/lib/setup-download-taskmill'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Modal, Progress, Space, Spin, Typography } from 'antd'
import { useEffect, useState } from 'react'
import {
  activeTasksJobs,
  downloadFfmpegSetup,
  ffmpegStatusSetup,
  getActiveTasksJobsQueryKey,
  getFfmpegStatusSetupQueryKey,
  getHistoryJobsQueryKey,
  getSnapshotJobsQueryKey,
  historyJobs,
  snapshotJobs,
} from '@/api'
import {
  mapSetupDownloadFromActiveRecord,
  mapSetupDownloadFromHistory,
  mapSetupDownloadFromSnapshot,
  uiProgressPercent,
} from '@/lib/setup-download-taskmill'

const ffmpegSetupStatusQueryKey = getFfmpegStatusSetupQueryKey()
const taskmillSnapshotQueryKey = getSnapshotJobsQueryKey()
const taskmillHistoryParams = { limit: 40, offset: 0 } as const
const taskmillActiveParams = { limit: 50 } as const

/** 设置页：FFmpeg 安装状态与 Taskmill 下载进度。 */
export function FfmpegSetupCard() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()

  const ffmpegSetupQuery = useQuery({
    queryKey: ffmpegSetupStatusQueryKey,
    queryFn: ffmpegStatusSetup,
  })

  const [ffmpegTaskId, setFfmpegTaskId] = useState<number | null>(null)
  const [ffmpegProgress, setFfmpegProgress] = useState<SetupDownloadUiProgress | null>(null)
  const [ffmpegBusy, setFfmpegBusy] = useState(false)

  const taskmillSnapshotQuery = useQuery({
    queryKey: taskmillSnapshotQueryKey,
    queryFn: () => snapshotJobs() as Promise<TaskmillJobSnapshot>,
    refetchInterval: ffmpegTaskId != null ? 500 : false,
  })

  const taskmillHistoryQuery = useQuery({
    queryKey: getHistoryJobsQueryKey(taskmillHistoryParams),
    queryFn: () => historyJobs(taskmillHistoryParams) as Promise<TaskmillTaskHistoryRecord[]>,
    enabled: ffmpegTaskId != null,
    refetchInterval: ffmpegTaskId != null ? 1000 : false,
  })

  const activeTasksQuery = useQuery({
    queryKey: getActiveTasksJobsQueryKey(taskmillActiveParams),
    queryFn: () => activeTasksJobs(taskmillActiveParams) as Promise<TaskmillTaskRecord[]>,
    enabled: ffmpegTaskId != null,
    refetchInterval: ffmpegTaskId != null ? 500 : false,
  })

  useEffect(() => {
    if (ffmpegSetupQuery.isError) {
      message.error(
        ffmpegSetupQuery.error instanceof Error
          ? ffmpegSetupQuery.error.message
          : '加载 FFmpeg 状态失败',
      )
    }
  }, [ffmpegSetupQuery.isError, ffmpegSetupQuery.error, message])

  useEffect(() => {
    const snapshot = taskmillSnapshotQuery.data
    const history = taskmillHistoryQuery.data
    const active = activeTasksQuery.data
    if (!snapshot || ffmpegTaskId == null) {
      return
    }

    const fromSnap = mapSetupDownloadFromSnapshot(snapshot, ffmpegTaskId)
    if (fromSnap) {
      setFfmpegProgress(fromSnap)
      return
    }

    const activeTask = active?.find(t => t.id === ffmpegTaskId)
    if (activeTask) {
      setFfmpegProgress(mapSetupDownloadFromActiveRecord(activeTask, snapshot))
      return
    }

    const record = history?.find(h => h.id === ffmpegTaskId)
    if (!record) {
      return
    }

    const terminal = mapSetupDownloadFromHistory(record)
    setFfmpegProgress(terminal)
    setFfmpegTaskId(null)
    setFfmpegBusy(false)
    if (terminal.status === 'done') {
      message.success(terminal.message || '下载完成')
      void queryClient.invalidateQueries({ queryKey: ffmpegSetupStatusQueryKey })
    }
    else {
      message.error(terminal.message || '下载失败')
    }
    setTimeout(setFfmpegProgress, 800, null)
  }, [
    ffmpegTaskId,
    taskmillSnapshotQuery.data,
    taskmillHistoryQuery.data,
    activeTasksQuery.data,
    message,
    queryClient,
  ])

  function openFfmpegDownloadModal() {
    Modal.confirm({
      title: '下载 FFmpeg',
      content: (
        <div className="space-y-2 text-neutral-700">
          <p>将清理未完成下载后，按当前系统自动选择构建（BtbN FFmpeg-Builds），并安装到配置的工具目录。</p>
          <p className="text-sm text-neutral-500">
            Linux / macOS 解压依赖本机
            {' '}
            <code className="rounded bg-neutral-100 px-1">tar</code>
            {' '}
            命令；Windows 使用 zip 解压。
          </p>
        </div>
      ),
      okText: '开始下载',
      cancelText: '取消',
      onOk: () => {
        setFfmpegBusy(true)
        setFfmpegProgress(null)
        return (async () => {
          try {
            const { job_id } = await downloadFfmpegSetup({})
            const taskId = Number.parseInt(job_id, 10)
            if (!Number.isFinite(taskId)) {
              throw new TypeError('无效的任务 ID')
            }
            setFfmpegTaskId(taskId)
            setFfmpegProgress({
              status: 'running',
              message: '任务已入队，正在启动…',
            })
          }
          catch (e) {
            setFfmpegBusy(false)
            message.error(e instanceof Error ? e.message : '启动下载失败')
            throw e
          }
        })()
      },
    })
  }

  const ffmpegDownloadBlocked = Boolean(ffmpegSetupQuery.data?.local_ready)

  return (
    <Card title="FFmpeg" variant="borderless" className="shadow-sm">
      <Space orientation="vertical" size="middle" className="w-full">
        <Spin spinning={ffmpegSetupQuery.isPending}>
          <Typography.Paragraph className="mb-0 text-neutral-600">
            为字幕流水线下载与当前系统匹配的静态构建，并写入 ffmpeg 工具目录。
            {ffmpegDownloadBlocked
              ? (
                  <Typography.Text type="success" className="ml-2 text-sm">
                    已就绪
                  </Typography.Text>
                )
              : null}
          </Typography.Paragraph>
        </Spin>
        <Button
          type="primary"
          onClick={openFfmpegDownloadModal}
          disabled={ffmpegBusy || ffmpegDownloadBlocked}
          loading={ffmpegBusy}
        >
          下载 FFmpeg（当前平台）
        </Button>
        {ffmpegDownloadBlocked
          ? (
              <Typography.Text type="secondary" className="text-sm">
                当前服务器工具目录中已存在 FFmpeg，无需重复下载。
              </Typography.Text>
            )
          : null}
        {ffmpegProgress
          ? (
              <div className="rounded border border-neutral-200 p-3">
                <Progress
                  percent={uiProgressPercent(ffmpegProgress)}
                  status={ffmpegProgress.status === 'error' ? 'exception' : 'active'}
                />
                <Typography.Paragraph className="mb-0 mt-2 text-xs text-neutral-600">
                  {ffmpegProgress.message}
                </Typography.Paragraph>
              </div>
            )
          : null}
      </Space>
    </Card>
  )
}
