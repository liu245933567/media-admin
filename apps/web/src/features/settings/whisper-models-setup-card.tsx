import type { ColumnDef } from '@tanstack/react-table'
import type { TaskmillJobSnapshot, TaskmillTaskHistoryRecord, WhisperModelItem } from '@/api'
import type { WhisperModelOption } from '@/features/subtitles/subtitle-pipeline-form-groups'
import type { SetupDownloadUiProgress, WhisperModelDownloadProgress } from '@/lib/setup-download-taskmill'
import { Button, Card, Chip, ProgressBar } from '@heroui/react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  downloadWhisperSetup,
  getHistoryJobsQueryKey,
  getListWhisperModelsSetupQueryKey,
  getSnapshotJobsQueryKey,
  historyJobs,
  listWhisperModelsSetup,
  snapshotJobs,
} from '@/api'
import { useAppToast } from '@/components/app-toast'
import { useConfirmDialog } from '@/components/confirm-dialog'
import { DataTable } from '@/components/data-table'
import { buildWhisperDownloadProgressByModelId, hasActiveWhisperDownloads, listActiveWhisperDownloadTasks, mapSetupDownloadFromHistory, mapSetupDownloadFromSnapshot, uiProgressPercent } from '@/lib/setup-download-taskmill'

const whisperModelsQueryKey = getListWhisperModelsSetupQueryKey()
const taskmillSnapshotQueryKey = getSnapshotJobsQueryKey()
const taskmillHistoryParams = { limit: 40, offset: 0 } as const

/** 供字幕表单等使用的 Whisper 模型下拉选项（与卡片共享同一 react-query 缓存）。 */
export function useWhisperModelFilenameOptions(): {
  options: WhisperModelOption[]
  loading: boolean
} {
  const whisperModelsQuery = useQuery({
    queryKey: whisperModelsQueryKey,
    queryFn: listWhisperModelsSetup,
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
  const message = useAppToast()
  const confirm = useConfirmDialog()
  const queryClient = useQueryClient()

  const whisperModelsQuery = useQuery({
    queryKey: whisperModelsQueryKey,
    queryFn: listWhisperModelsSetup,
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
    queryFn: () => snapshotJobs() as Promise<TaskmillJobSnapshot>,
    refetchInterval: (query) => {
      const snap = query.state.data
      const whisperActive = snap != null && hasActiveWhisperDownloads(snap)
      const tracking = whisperTaskId != null || whisperActive
      return tracking ? 500 : false
    },
  })

  const taskmillHistoryQuery = useQuery({
    queryKey: getHistoryJobsQueryKey(taskmillHistoryParams),
    queryFn: () => historyJobs(taskmillHistoryParams) as Promise<TaskmillTaskHistoryRecord[]>,
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

  const startWhisperModelDownload = useCallback(async (modelId: string) => {
    setWhisperProgress(null)
    setDownloadingModelId(modelId)
    try {
      const { job_id } = await downloadWhisperSetup({ model_id: modelId })
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
    confirm({
      title: '下载 Whisper 模型',
      description: (
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
      confirmText: '开始下载',
      onConfirm: () => startWhisperModelDownload(modelId),
    })
  }, [confirm, models, startWhisperModelDownload])

  const whisperModelColumns: ColumnDef<WhisperModelItem, unknown>[] = useMemo(
    () => [
      {
        header: '模型',
        accessorKey: 'label',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.label}</div>
            <div className="text-xs text-neutral-500">{row.original.description}</div>
          </div>
        ),
      },
      {
        header: '文件名',
        accessorKey: 'filename',
        cell: ({ row }) => (
          <code className="rounded bg-surface-secondary px-1 py-0.5 text-xs">
            {row.original.filename}
          </code>
        ),
      },
      {
        header: '大小',
        accessorKey: 'size_hint',
      },
      {
        header: '状态',
        id: 'status',
        enableSorting: false,
        cell: ({ row }) => {
          const dl = whisperProgressByModelId.get(row.original.id)
          if (dl) {
            return (
              <div className="min-w-[200px]">
                <ProgressBar
                  aria-label="模型下载进度"
                  color={dl.status === 'error' ? 'danger' : 'accent'}
                  size="sm"
                  value={uiProgressPercent(dl)}
                >
                  <ProgressBar.Track>
                    <ProgressBar.Fill />
                  </ProgressBar.Track>
                </ProgressBar>
                <span className="mt-1 block text-xs text-muted">
                  {dl.message}
                </span>
              </div>
            )
          }
          if (row.original.local_ready) {
            return <Chip color="success" size="sm" variant="soft">已就绪</Chip>
          }
          return <Chip size="sm" variant="soft">未安装</Chip>
        },
      },
      {
        header: '操作',
        id: 'action',
        enableSorting: false,
        cell: ({ row }) => {
          const dl = whisperProgressByModelId.get(row.original.id)
          const isThisDownloading = dl?.status === 'running'
          const blocked = row.original.local_ready || (anyWhisperDownloadActive && !isThisDownloading)
          return (
            <Button
              size="sm"
              variant="tertiary"
              isDisabled={blocked}
              isPending={isThisDownloading}
              onPress={() => openWhisperDownloadModal(row.original.id)}
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
    <Card>
      <Card.Header>
        <Card.Title>Whisper 模型</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-3">
        <p className="m-0 text-sm text-neutral-600">
          状态与后台 Taskmill 下载任务同步；进行中的任务会在表格中显示进度。
        </p>
        <DataTable
          ariaLabel="Whisper 模型"
          columns={whisperModelColumns}
          data={models}
          locale={{ emptyText: '暂无模型' }}
          rowKey={row => row.id}
          loading={whisperModelsQuery.isPending}
          scroll={{ x: 760 }}
          pagination={false}
        />
      </Card.Content>
    </Card>
  )
}
