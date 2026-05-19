import type { SetupDownloadUiProgress } from '@/lib/setup-download-taskmill'
import type { AppConfig } from '@/types'
import {
  PageContainer,
  ProForm,
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
  Space,
  Spin,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'
import { StashConfigFormGroup } from '@/components/stash-config-form-group'
import { SubtitlePipelineFormGroups } from '@/components/subtitle-pipeline-form-groups'
import {
  useWhisperModelFilenameOptions,
  WhisperModelsSetupCard,
} from '@/components/whisper-models-setup-card'
import {
  mapSetupDownloadFromHistory,
  mapSetupDownloadFromSnapshot,
  uiProgressPercent,
} from '@/lib/setup-download-taskmill'
import {
  appConfigQueryKey,
  fetchAppConfig,
  fetchFfmpegSetupStatus,
  fetchTaskmillHistory,
  fetchTaskmillSnapshot,
  ffmpegSetupStatusQueryKey,
  startFfmpegDownload,
  subtitleGenerateDefaultsQueryKey,
  taskmillHistoryQueryKey,
  taskmillSnapshotQueryKey,
  updateAppConfig,
} from '@/request'

export const Route = createFileRoute('/setting')({
  component: RouteComponent,
})

function RouteComponent() {
  const { message } = App.useApp()
  const queryClient = useQueryClient()
  const { options: whisperModelFilenameOptions, loading: whisperModelsLoading }
    = useWhisperModelFilenameOptions()

  const appCfgQuery = useQuery({
    queryKey: appConfigQueryKey,
    queryFn: fetchAppConfig,
  })

  useEffect(() => {
    if (appCfgQuery.isError) {
      message.error(
        appCfgQuery.error instanceof Error
          ? appCfgQuery.error.message
          : '加载全局默认参数失败',
      )
    }
  }, [appCfgQuery.isError, appCfgQuery.error, message])

  const ffmpegSetupQuery = useQuery({
    queryKey: ffmpegSetupStatusQueryKey,
    queryFn: fetchFfmpegSetupStatus,
  })

  const [ffmpegTaskId, setFfmpegTaskId] = useState<number | null>(null)
  const [ffmpegProgress, setFfmpegProgress] = useState<SetupDownloadUiProgress | null>(null)
  const [ffmpegBusy, setFfmpegBusy] = useState(false)

  const taskmillSnapshotQuery = useQuery({
    queryKey: taskmillSnapshotQueryKey,
    queryFn: fetchTaskmillSnapshot,
    refetchInterval: ffmpegTaskId != null ? 500 : false,
  })

  const taskmillHistoryQuery = useQuery({
    queryKey: taskmillHistoryQueryKey({ limit: 40, offset: 0 }),
    queryFn: () => fetchTaskmillHistory({ limit: 40, offset: 0 }),
    enabled: ffmpegTaskId != null,
    refetchInterval: ffmpegTaskId != null ? 1000 : false,
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
    if (!snapshot || ffmpegTaskId == null) {
      return
    }

    const fromSnap = mapSetupDownloadFromSnapshot(snapshot, ffmpegTaskId)
    if (fromSnap) {
      setFfmpegProgress(fromSnap)
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
      onOk: async () => {
        setFfmpegBusy(true)
        setFfmpegProgress(null)
        try {
          const { job_id } = await startFfmpegDownload({})
          const taskId = Number.parseInt(job_id, 10)
          if (!Number.isFinite(taskId)) {
            throw new TypeError('无效的任务 ID')
          }
          setFfmpegTaskId(taskId)
          setFfmpegProgress({
            status: 'running',
            message: '任务已入队，等待执行…',
          })
        }
        catch (e) {
          setFfmpegBusy(false)
          message.error(e instanceof Error ? e.message : '启动下载失败')
        }
      },
    })
  }

  const ffmpegDownloadBlocked = Boolean(ffmpegSetupQuery.data?.local_ready)

  const appConfigFormKey = appCfgQuery.isSuccess
    ? String(appCfgQuery.dataUpdatedAt)
    : appCfgQuery.isError
      ? 'err'
      : 'pending'

  return (
    <PageContainer title="设置" subTitle="模型与工具下载">
      <Space orientation="vertical" size="large" className="w-full">
        <Alert
          type="info"
          showIcon
          title="下载目录与安装路径由服务端配置（环境变量 DOWNLOAD_DIR、MODELS_DIR、FFMPEG_DIR 或默认 ~/.media-admin 下子目录）。"
        />

        <Card title="应用默认参数" variant="borderless" className="shadow-sm">
          <Typography.Paragraph className="mb-4 text-sm text-neutral-600">
            以下参数持久化在本地
            <code className="mx-1 rounded bg-neutral-100 px-1">app_config.json</code>
            。翻译与 Stash 的
            <code className="mx-1 rounded bg-neutral-100 px-1">API Key</code>
            /
            <code className="mx-1 rounded bg-neutral-100 px-1">ApiKey</code>
            留空保存时不覆盖已存密钥。
          </Typography.Paragraph>
          <Spin spinning={appCfgQuery.isPending}>
            {appCfgQuery.data
              ? (
                  <ProForm<AppConfig>
                    key={appConfigFormKey}
                    grid
                    layout="vertical"
                    initialValues={appCfgQuery.data}
                    submitter={{
                      searchConfig: { submitText: '保存默认参数' },
                    }}
                    onFinish={async (vals) => {
                      try {
                        await updateAppConfig(vals)
                        message.success('已保存全局默认参数')
                        void queryClient.invalidateQueries({ queryKey: appConfigQueryKey })
                        void queryClient.invalidateQueries({ queryKey: subtitleGenerateDefaultsQueryKey })
                        return true
                      }
                      catch (e) {
                        message.error(e instanceof Error ? e.message : '保存失败')
                        return false
                      }
                    }}
                  >
                    <StashConfigFormGroup variant="setting" />
                    <SubtitlePipelineFormGroups
                      whisperModelFilenameOptions={whisperModelFilenameOptions}
                      whisperModelsLoading={whisperModelsLoading}
                      showTranslateGroup
                      variant="setting"
                    />
                  </ProForm>
                )
              : (
                  !appCfgQuery.isPending && (
                    <Typography.Text type="secondary">无法加载默认参数</Typography.Text>
                  )
                )}
          </Spin>
        </Card>

        <WhisperModelsSetupCard />

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
                  <div className="rounded border border-neutral-200 bg-neutral-50 p-3">
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
      </Space>
    </PageContainer>
  )
}
