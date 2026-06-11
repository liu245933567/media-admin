import type { AppConfig } from '@/api'
import { Button, Card, Spinner } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import {
  getAppConfigSettings,
  getGetAppConfigSettingsQueryKey,
  putAppConfigSettings,
  PutAppConfigSettingsBody,
} from '@/api'
import { useAppToast } from '@/components/app-toast'
import { StashConfigFormGroup } from '@/components/stash-config-form-group'

export const Route = createFileRoute('/setting/stash')({
  component: StashSettingPage,
})

function StashConfigForm({
  initialValues,
  onSaved,
}: {
  initialValues: AppConfig
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
      message.success('已保存 Stash 设置')
      void queryClient.invalidateQueries({ queryKey: appConfigQueryKey })
      void queryClient.invalidateQueries({ queryKey: ['stash-scenes'] })
      onSaved()
    }
    catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={form.handleSubmit(handleSubmit)}>
      <StashConfigFormGroup control={form.control} variant="setting" />
      <div>
        <Button type="submit" isPending={form.formState.isSubmitting}>
          保存 Stash 设置
        </Button>
      </div>
    </form>
  )
}

function StashSettingPage() {
  const message = useAppToast()
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
          : '加载 Stash 设置失败',
      )
    }
  }, [appCfgQuery.isError, appCfgQuery.error, message])

  const appConfigFormKey = appCfgQuery.isSuccess
    ? String(appCfgQuery.dataUpdatedAt)
    : appCfgQuery.isError
      ? 'err'
      : 'pending'

  return (
    <Card>
      <Card.Header>
        <Card.Title>Stash 设置</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">
          Stash 连接与路径映射持久化在本地
          <code className="mx-1 rounded bg-surface-secondary px-1">app_config.json</code>
          。ApiKey 留空保存时不覆盖已存密钥。
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
                <StashConfigForm
                  key={appConfigFormKey}
                  initialValues={appCfgQuery.data}
                  onSaved={() => appCfgQuery.refetch()}
                />
              )
            : (
                <span className="text-sm text-muted">无法加载 Stash 设置</span>
              )}
      </Card.Content>
    </Card>
  )
}
