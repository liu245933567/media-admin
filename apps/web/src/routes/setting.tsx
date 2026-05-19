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
  Card,
  Space,
  Spin,
  Typography,
} from 'antd'
import { useEffect } from 'react'
import { FfmpegSetupCard } from '@/components/ffmpeg-setup-card'
import { StashConfigFormGroup } from '@/components/stash-config-form-group'
import { SubtitlePipelineFormGroups } from '@/components/subtitle-pipeline-form-groups'
import {
  useWhisperModelFilenameOptions,
  WhisperModelsSetupCard,
} from '@/components/whisper-models-setup-card'
import {
  appConfigQueryKey,
  fetchAppConfig,
  subtitleGenerateDefaultsQueryKey,
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

        <FfmpegSetupCard />
      </Space>
    </PageContainer>
  )
}
