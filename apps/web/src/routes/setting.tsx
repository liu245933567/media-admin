import type { RefObject } from 'react'
import type { DownloadProgressSnapshot, WhisperModelItem } from '@/types'
import {
  PageContainer,
} from '@ant-design/pro-components'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  Alert,
  App,
  Button,
  Card,
  Modal,
  Progress,
  Radio,
  Space,
  Spin,
  Typography,
} from 'antd'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchFfmpegSetupStatus,
  fetchWhisperModels,
  ffmpegSetupStatusQueryKey,
  startFfmpegDownload,
  startWhisperDownload,
  whisperModelsQueryKey,
} from '@/request'

export const Route = createFileRoute('/setting')({
  component: RouteComponent,
})

function closeEventSource(r: RefObject <EventSource | null>) {
  if (r.current) {
    r.current.close()
    r.current = null
  }
}

function subscribeDownloadJob(
  jobId: string,
  ref: RefObject <EventSource | null>,
  onProgress: (p: DownloadProgressSnapshot) => void,
  onTerminal: (p: DownloadProgressSnapshot) => void,
  onTransportError: () => void,
) {
  closeEventSource(ref)
  const es = new EventSource(
    `/api/setup/download-jobs/${encodeURIComponent(jobId)}/stream`,
  )
  ref.current = es
  es.addEventListener('progress', (ev) => {
    try {
      const raw = (ev as MessageEvent<string>).data
      const d = JSON.parse(raw) as DownloadProgressSnapshot
      onProgress(d)
      if (d.phase === 'done' || d.phase === 'error') {
        onTerminal(d)
        setTimeout(() => {
          if (ref.current === es) {
            es.close()
            ref.current = null
          }
        }, 500)
      }
    }
    catch {
      onTransportError()
    }
  })
  es.onerror = () => {
    onTransportError()
    closeEventSource(ref)
  }
}

function progressPercent(p: DownloadProgressSnapshot | null): number | undefined {
  if (!p?.bytes_total || p.bytes_total <= 0)
    return undefined
  return Math.min(100, Math.round((100 * p.bytes_received) / p.bytes_total))
}

function RouteComponent() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const whisperModelsQuery = useQuery({
    queryKey: whisperModelsQueryKey,
    queryFn: fetchWhisperModels,
  })

  const ffmpegSetupQuery = useQuery({
    queryKey: ffmpegSetupStatusQueryKey,
    queryFn: fetchFfmpegSetupStatus,
  })

  const models = useMemo(
    () => whisperModelsQuery.data?.items ?? [],
    [whisperModelsQuery.data],
  )

  const [selectedModelId, setSelectedModelId] = useState<string>('large-v3')

  const effectiveModelId = useMemo(() => {
    if (models.length === 0)
      return selectedModelId
    return models.some(m => m.id === selectedModelId) ? selectedModelId : models[0].id
  }, [models, selectedModelId])
  const [whisperProgress, setWhisperProgress] = useState<DownloadProgressSnapshot | null>(null)
  const [ffmpegProgress, setFfmpegProgress] = useState<DownloadProgressSnapshot | null>(null)
  const whisperEsRef = useRef<EventSource | null>(null)
  const ffmpegEsRef = useRef<EventSource | null>(null)
  const [whisperBusy, setWhisperBusy] = useState(false)
  const [ffmpegBusy, setFfmpegBusy] = useState(false)

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
    if (ffmpegSetupQuery.isError) {
      message.error(
        ffmpegSetupQuery.error instanceof Error
          ? ffmpegSetupQuery.error.message
          : '加载 FFmpeg 状态失败',
      )
    }
  }, [ffmpegSetupQuery.isError, ffmpegSetupQuery.error, message])

  useEffect(() => {
    return () => {
      closeEventSource(whisperEsRef)
      closeEventSource(ffmpegEsRef)
    }
  }, [])

  function openWhisperDownloadModal() {
    const item = models.find(m => m.id === effectiveModelId)
    Modal.confirm({
      title: '下载 Whisper 模型',
      content: (
        <div className="space-y-2 text-neutral-700">
          <p>
            将清理未完成下载后，从暂存目录下载并写入模型目录。当前选择：
            <strong>{item ? ` ${item.label}（${item.filename}）` : ''}</strong>
          </p>
          <p className="text-sm text-neutral-500">
            下载过程中请勿关闭页面；同一时间仅建议进行一项下载任务。
          </p>
        </div>
      ),
      okText: '开始下载',
      cancelText: '取消',
      onOk: async () => {
        setWhisperBusy(true)
        setWhisperProgress(null)
        try {
          const { job_id } = await startWhisperDownload({ model_id: effectiveModelId })
          subscribeDownloadJob(
            job_id,
            whisperEsRef,
            setWhisperProgress,
            (d) => {
              setWhisperBusy(false)
              if (d.phase === 'done') {
                message.success(d.message || '模型已就绪')
                void queryClient.invalidateQueries({ queryKey: whisperModelsQueryKey })
              }
              else {
                message.error(d.message || '下载失败')
              }
            },
            () => {
              setWhisperBusy(false)
              message.error('进度连接中断')
            },
          )
        }
        catch (e) {
          setWhisperBusy(false)
          message.error(e instanceof Error ? e.message : '启动下载失败')
        }
      },
    })
  }

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
      onOk: async () => {
        setFfmpegBusy(true)
        setFfmpegProgress(null)
        try {
          const { job_id } = await startFfmpegDownload({})
          subscribeDownloadJob(
            job_id,
            ffmpegEsRef,
            setFfmpegProgress,
            (d) => {
              setFfmpegBusy(false)
              if (d.phase === 'done') {
                message.success(d.message || 'FFmpeg 已就绪')
                void queryClient.invalidateQueries({ queryKey: ffmpegSetupStatusQueryKey })
              }
              else {
                message.error(d.message || '下载失败')
              }
            },
            () => {
              setFfmpegBusy(false)
              message.error('进度连接中断')
            },
          )
        }
        catch (e) {
          setFfmpegBusy(false)
          message.error(e instanceof Error ? e.message : '启动下载失败')
        }
      },
    })
  }

  const selectedModel: WhisperModelItem | undefined = models.find(m => m.id === effectiveModelId)
  const whisperDownloadBlocked = Boolean(selectedModel?.local_ready)
  const ffmpegDownloadBlocked = Boolean(ffmpegSetupQuery.data?.local_ready)

  return (
    <PageContainer title="设置" subTitle="模型与工具下载">
      <Space orientation="vertical" size="large" className="w-full max-w-3xl">
        <Alert
          type="info"
          showIcon
          title="下载目录与安装路径由服务端配置（环境变量 DOWNLOAD_DIR、MODELS_DIR、FFMPEG_DIR 或默认 ~/.media-admin 下子目录）。"
        />

        <Card title="Whisper 模型" variant="borderless" className="shadow-sm">
          <Space direction="vertical" size="middle" className="w-full">
            <Spin spinning={whisperModelsQuery.isPending}>
              <Radio.Group
                value={effectiveModelId}
                onChange={e => setSelectedModelId(e.target.value)}
                disabled={whisperBusy}
              >
                <Space direction="vertical" className="w-full">
                  {models.map(m => (
                    <Radio key={m.id} value={m.id} className="w-full">
                      <span className="font-medium">{m.label}</span>
                      <Typography.Text type="secondary" className="ml-2 text-sm">
                        {m.filename}
                        {' · '}
                        {m.size_hint}
                      </Typography.Text>
                      {m.local_ready
                        ? (
                            <Typography.Text type="success" className="ml-2 text-sm">
                              已就绪
                            </Typography.Text>
                          )
                        : null}
                      <div className="text-xs text-neutral-500">{m.description}</div>
                    </Radio>
                  ))}
                </Space>
              </Radio.Group>
            </Spin>
            <Button
              type="primary"
              onClick={openWhisperDownloadModal}
              disabled={whisperBusy || models.length === 0 || whisperDownloadBlocked}
              loading={whisperBusy}
            >
              确认下载所选模型
            </Button>
            {whisperDownloadBlocked
              ? (
                  <Typography.Text type="secondary" className="text-sm">
                    当前所选模型已在服务器模型目录中存在，无需重复下载。
                  </Typography.Text>
                )
              : null}
            {whisperProgress
              ? (
                  <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
                    <div className="mb-1 text-sm text-neutral-600">
                      阶段：
                      {whisperProgress.phase}
                    </div>
                    <Progress
                      percent={progressPercent(whisperProgress)}
                      status={whisperProgress.phase === 'error' ? 'exception' : 'active'}
                    />
                    <Typography.Paragraph className="mb-0 mt-2 text-xs text-neutral-600">
                      {whisperProgress.message}
                    </Typography.Paragraph>
                  </div>
                )
              : null}
          </Space>
        </Card>

        <Card title="FFmpeg" variant="borderless" className="shadow-sm">
          <Space direction="vertical" size="middle" className="w-full">
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
                  <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
                    <div className="mb-1 text-sm text-neutral-600">
                      阶段：
                      {ffmpegProgress.phase}
                    </div>
                    <Progress
                      percent={progressPercent(ffmpegProgress)}
                      status={ffmpegProgress.phase === 'error' ? 'exception' : 'active'}
                    />
                    <Typography.Paragraph className="mb-0 mt-2 text-xs text-neutral-600">
                      {ffmpegProgress.message}
                    </Typography.Paragraph>
                  </div>
                )
              : null}
          </Space>
        </Card>
      </Space>
    </PageContainer>
  )
}
