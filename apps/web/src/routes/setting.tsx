import type { AppConfig } from '@/api'
import { Alert, Button, Card, Spinner } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import {
  getAppConfigSettings,
  getGenerateDefaultsJobsQueryKey,
  getGetAppConfigSettingsQueryKey,
  putAppConfigSettings,
  PutAppConfigSettingsBody,
} from '@/api'
import { AppPage } from '@/components/app-page'
import { useAppToast } from '@/components/app-toast'
import { FfmpegSetupCard } from '@/components/ffmpeg-setup-card'
import { MediaRootListCard } from '@/components/media-root-list-card'
import { StashConfigFormGroup } from '@/components/stash-config-form-group'
import { SubtitlePipelineFormGroups } from '@/components/subtitle-pipeline-form-groups'
import {
  useWhisperModelFilenameOptions,
  WhisperModelsSetupCard,
} from '@/components/whisper-models-setup-card'

export const Route = createFileRoute('/setting')({
  component: RouteComponent,
})

function AppConfigForm({
  initialValues,
  whisperModelFilenameOptions,
  whisperModelsLoading,
  onSaved,
}: {
  initialValues: AppConfig
  whisperModelFilenameOptions: { label: string, value: string }[]
  whisperModelsLoading: boolean
  onSaved: () => void
}) {
  const message = useAppToast()
  const queryClient = useQueryClient()
  const appConfigQueryKey = getGetAppConfigSettingsQueryKey()
  const form = useForm<AppConfig>({
    resolver: zodResolver(PutAppConfigSettingsBody),
    defaultValues: initialValues,
  })

  async function handleSubmit(values: AppConfig) {
    try {
      await putAppConfigSettings(values)
      message.success('已保存全局默认参数')
      void queryClient.invalidateQueries({ queryKey: appConfigQueryKey })
      void queryClient.invalidateQueries({ queryKey: getGenerateDefaultsJobsQueryKey() })
      onSaved()
    }
    catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={form.handleSubmit(handleSubmit)}>
      <StashConfigFormGroup control={form.control} variant="setting" />
      <SubtitlePipelineFormGroups
        control={form.control}
        whisperModelFilenameOptions={whisperModelFilenameOptions}
        whisperModelsLoading={whisperModelsLoading}
        showTranslateGroup
        variant="setting"
      />
      <div>
        <Button type="submit" isPending={form.formState.isSubmitting}>
          保存默认参数
        </Button>
      </div>
    </form>
  )
}

function RouteComponent() {
  const message = useAppToast()
  const { options: whisperModelFilenameOptions, loading: whisperModelsLoading }
    = useWhisperModelFilenameOptions()
  const appConfigQueryKey = getGetAppConfigSettingsQueryKey()

  const appCfgQuery = useQuery({
    queryKey: appConfigQueryKey,
    queryFn: getAppConfigSettings,
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
    <AppPage title="设置" description="模型与工具下载">
      <div className="flex w-full flex-col gap-6">
        <Alert status="accent">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              下载目录与安装路径由服务端配置（环境变量 DOWNLOAD_DIR、MODELS_DIR、FFMPEG_DIR 或默认 ~/.media-admin 下子目录）。
            </Alert.Title>
          </Alert.Content>
        </Alert>

        <Card>
          <Card.Header>
            <Card.Title>应用默认参数</Card.Title>
          </Card.Header>
          <Card.Content className="flex flex-col gap-4">
            <p className="m-0 text-sm text-neutral-600">
              以下参数持久化在本地
              <code className="mx-1 rounded bg-neutral-100 px-1">app_config.json</code>
              。翻译与 Stash 的
              <code className="mx-1 rounded bg-neutral-100 px-1">API Key</code>
              /
              <code className="mx-1 rounded bg-neutral-100 px-1">ApiKey</code>
              留空保存时不覆盖已存密钥。
            </p>
            {appCfgQuery.isPending
              ? (
                  <div className="flex items-center gap-2 py-6 text-sm text-muted">
                    <Spinner size="sm" />
                    加载中...
                  </div>
                )
              : appCfgQuery.data
                ? (
                    <AppConfigForm
                      key={appConfigFormKey}
                      initialValues={appCfgQuery.data}
                      whisperModelFilenameOptions={whisperModelFilenameOptions}
                      whisperModelsLoading={whisperModelsLoading}
                      onSaved={() => appCfgQuery.refetch()}
                    />
                  )
                : (
                    <span className="text-sm text-muted">无法加载默认参数</span>
                  )}
          </Card.Content>
        </Card>

        <WhisperModelsSetupCard />

        <FfmpegSetupCard />

        <MediaRootListCard />
      </div>
    </AppPage>
  )
}
