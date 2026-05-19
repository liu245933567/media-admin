import type { ColumnsType } from 'antd/es/table'
import type { WhisperModelDownloadProgress } from '@/lib/setup-download-taskmill'
import type { WhisperModelItem } from '@/types'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Button,
  Card,
  Modal,
  Progress,
  Table,
  Tag,
  Typography,
} from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WhisperModelOption } from '@/components/subtitle-pipeline-form-groups'
import {
  buildWhisperDownloadProgressByModelId,
  hasActiveWhisperDownloads,
  listActiveWhisperDownloadTasks,
  mapSetupDownloadFromHistory,
  mapSetupDownloadFromSnapshot,
  uiProgressPercent,
  type SetupDownloadUiProgress,
} from '@/lib/setup-download-taskmill'
import {
  fetchTaskmillHistory,
  fetchTaskmillSnapshot,
  fetchWhisperModels,
  startWhisperDownload,
  taskmillHistoryQueryKey,
  taskmillSnapshotQueryKey,
  whisperModelsQueryKey,
} from '@/request'

/** 供字幕表单等使用的 Whisper 模型下拉选项（与卡片共享同一 react-query 缓存）。 */
export function useWhisperModelFilenameOptions(): {
  options: WhisperModelOption[]
  loading: boolean
} {
  const whisperModelsQuery = useQuery({
    queryKey: whisperModelsQueryKey,
    queryFn: fetchWhisperModels,
  })
  const models = useMemo(
    () => whisperModelsQuery.data?.items ?? [],
    [whisperModelsQuery.data],
  )
  const options = useMemo(
    () =>
      models.map(m => ({
        label: `${m.label}（${m.filename}）${m.local_ready ? ' · 已就绪' : ''}`,
        value: m.filename,
      })),
    [models],
  )
  return { options, loading: whisperModelsQuery.isPending }
}

/** 设置页：Whisper 模型列表与 Taskmill 下载进度。 */
export function WhisperModelsSetupCard() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()

  const whisperModelsQuery = useQuery({
    queryKey: whisperModelsQueryKey,
    queryFn: fetchWhisperModels,
  })

  const models = useMemo(
    () => whisperModelsQuery.data?.items ?? [],
    [whisperModelsQuery.data],
  )

  const [whisperTaskId, setWhisperTaskId] = useState<number | null>(null)
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null)
  const [whisperProgress, setWhisperProgress] = useState<SetupDownloadUiProgress | null>(null)

  const taskmillSnapshotQuery = useQuery({
    queryKey: taskmillSnapshotQueryKey,
    queryFn: fetchTaskmillSnapshot,
    refetchInterval: (query) => {
      const snap = query.state.data
      const whisperActive = snap != null && hasActiveWhisperDownloads(snap)
      const tracking = whisperTaskId != null || whisperActive
      return tracking ? 500 : false
    },
  })

  const taskmillHistoryQuery = useQuery({
    queryKey: taskmillHistoryQueryKey({ limit: 40, offset: 0 }),
    queryFn: () => fetchTaskmillHistory({ limit: 40, offset: 0 }),
    enabled: whisperTaskId != null,
    refetchInterval: whisperTaskId != null ? 1000 : false,
  })

  const whisperProgressByModelId = useMemo(() => {
    const map = taskmillSnapshotQuery.data
      ? buildWhisperDownloadProgressByModelId(taskmillSnapshotQuery.data)
      : new Map<string, WhisperModelDownloadProgress>()
    if (downloadingModelId && whisperProgress && whisperTaskId != null) {
      map.set(downloadingModelId, { ...whisperProgress, taskId: whisperTaskId })
    }
    return map
  }, [
    taskmillSnapshotQuery.data,
    downloadingModelId,
    whisperProgress,
    whisperTaskId,
  ])

  const anyWhisperDownloadActive = whisperProgressByModelId.size > 0

  useEffect(() => {
    const snap = taskmillSnapshotQuery.data
    if (!snap) {
      return
    }
    const active = listActiveWhisperDownloadTasks(snap)
    if (active.length === 1 && whisperTaskId == null) {
      setDownloadingModelId(active[0].modelId)
      setWhisperTaskId(active[0].taskId)
    }
  }, [taskmillSnapshotQuery.data, whisperTaskId])

  useEffect(() => {
    if (anyWhisperDownloadActive) {
      const id = setInterval(() => {
        void queryClient.invalidateQueries({ queryKey: whisperModelsQueryKey })
      }, 3000)
      return () => clearInterval(id)
    }
  }, [anyWhisperDownloadActive, queryClient])

  useEffect(() => {
    if (whisperModelsQuery.isError) {
      message.error(
        whisperModelsQuery.error instanceof Error
          ? whisperModelsQuery.error.message
          : '加载模型列表失败',
      )
    }
  }, [whisperModelsQuery.isError, whisperModelsQuery.error, message])

  useEffect(() => {
    const snapshot = taskmillSnapshotQuery.data
    const history = taskmillHistoryQuery.data
    if (!snapshot || whisperTaskId == null) {
      return
    }

    const fromSnap = mapSetupDownloadFromSnapshot(snapshot, whisperTaskId)
    if (fromSnap) {
      setWhisperProgress(fromSnap)
      return
    }

    const record = history?.find(h => h.id === whisperTaskId)
    if (!record) {
      return
    }

    const terminal = mapSetupDownloadFromHistory(record)
    setWhisperProgress(terminal)
    setWhisperTaskId(null)
    setDownloadingModelId(null)
    if (terminal.status === 'done') {
      message.success(terminal.message || '下载完成')
      void queryClient.invalidateQueries({ queryKey: whisperModelsQueryKey })
    }
    else {
      message.error(terminal.message || '下载失败')
    }
    setTimeout(setWhisperProgress, 800, null)
  }, [
    whisperTaskId,
    taskmillSnapshotQuery.data,
    taskmillHistoryQuery.data,
    message,
    queryClient,
  ])

  const startWhisperDownloadForModel = useCallback(async (modelId: string) => {
    setWhisperProgress(null)
    setDownloadingModelId(modelId)
    try {
      const { job_id } = await startWhisperDownload({ model_id: modelId })
      const taskId = Number.parseInt(job_id, 10)
      if (!Number.isFinite(taskId)) {
        throw new TypeError('无效的任务 ID')
      }
      setWhisperTaskId(taskId)
      setWhisperProgress({
        status: 'running',
        message: '任务已入队，等待执行…',
      })
      void queryClient.invalidateQueries({ queryKey: taskmillSnapshotQueryKey })
    }
    catch (e) {
      setDownloadingModelId(null)
      message.error(e instanceof Error ? e.message : '启动下载失败')
    }
  }, [message, queryClient])

  const openWhisperDownloadModal = useCallback((modelId: string) => {
    const item = models.find(m => m.id === modelId)
    if (!item || item.local_ready) {
      return
    }
    Modal.confirm({
      title: '下载 Whisper 模型',
      content: (
        <div className="space-y-2 text-neutral-700">
          <p>
            将清理未完成下载后，从暂存目录下载并写入模型目录：
            <strong>{` ${item.label}（${item.filename}）`}</strong>
          </p>
          <p className="text-sm text-neutral-500">
            同一时间仅可执行一项设置页下载任务。
          </p>
        </div>
      ),
      okText: '开始下载',
      cancelText: '取消',
      onOk: () => startWhisperDownloadForModel(modelId),
    })
  }, [models, startWhisperDownloadForModel])

  const whisperModelColumns: ColumnsType<WhisperModelItem> = useMemo(
    () => [
      {
        title: '模型',
        dataIndex: 'label',
        key: 'label',
        render: (_, row) => (
          <div>
            <div className="font-medium">{row.label}</div>
            <div className="text-xs text-neutral-500">{row.description}</div>
          </div>
        ),
      },
      {
        title: '文件名',
        dataIndex: 'filename',
        key: 'filename',
        width: 200,
        render: (filename: string) => (
          <Typography.Text code className="text-xs">
            {filename}
          </Typography.Text>
        ),
      },
      {
        title: '大小',
        dataIndex: 'size_hint',
        key: 'size_hint',
        width: 100,
      },
      {
        title: '状态',
        key: 'status',
        width: 280,
        render: (_, row) => {
          const dl = whisperProgressByModelId.get(row.id)
          if (dl) {
            return (
              <div className="min-w-[200px]">
                <Progress
                  percent={uiProgressPercent(dl)}
                  size="small"
                  status={dl.status === 'error' ? 'exception' : 'active'}
                />
                <Typography.Text type="secondary" className="mt-1 block text-xs">
                  {dl.message}
                </Typography.Text>
              </div>
            )
          }
          if (row.local_ready) {
            return <Tag color="success">已就绪</Tag>
          }
          return <Tag>未安装</Tag>
        },
      },
      {
        title: '操作',
        key: 'action',
        width: 100,
        render: (_, row) => {
          const dl = whisperProgressByModelId.get(row.id)
          const isThisDownloading = dl?.status === 'running'
          const blocked = row.local_ready || (anyWhisperDownloadActive && !isThisDownloading)
          return (
            <Button
              type="link"
              size="small"
              disabled={blocked}
              loading={isThisDownloading}
              onClick={() => openWhisperDownloadModal(row.id)}
            >
              下载
            </Button>
          )
        },
      },
    ],
    [whisperProgressByModelId, anyWhisperDownloadActive, openWhisperDownloadModal],
  )

  return (
    <Card title="Whisper 模型" variant="borderless" className="shadow-sm">
      <Typography.Paragraph className="mb-3 text-sm text-neutral-600">
        状态与后台 Taskmill 下载任务同步；进行中的任务会在表格中显示进度。
      </Typography.Paragraph>
      <Table<WhisperModelItem>
        rowKey="id"
        size="small"
        loading={whisperModelsQuery.isPending}
        columns={whisperModelColumns}
        dataSource={models}
        pagination={false}
        scroll={{ x: 720 }}
      />
    </Card>
  )
}
