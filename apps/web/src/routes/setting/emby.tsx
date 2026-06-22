import type { AppConfig } from '@/api'
import { Button, Card, Chip, Spinner } from '@heroui/react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Icon } from '@iconify/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import {
  getAppConfigSettings,
  getGetAppConfigSettingsQueryKey,
  putAppConfigSettings,
  PutAppConfigSettingsBody,
  testConnectionEmby,
} from '@/api'
import { useAppToast } from '@/components/app-toast'
import { EmbyConfigFormGroup } from '@/features/settings/emby-config-form-group'

export const Route = createFileRoute('/setting/emby')({
  component: EmbySettingPage,
})

function EmbyConfigForm({
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

  const testConnectionMutation = useMutation({
    mutationFn: () => testConnectionEmby(),
    onSuccess: (res) => {
      const server = res.server_name ? `：${res.server_name}` : ''
      message.success(`Emby 连接成功${server}`)
      if (res.user_id) {
        form.setValue('emby_config.user_id', res.user_id, { shouldDirty: true })
      }
    },
    onError: error => message.error(error.message ?? 'Emby 连接失败'),
  })

  async function handleSubmit(values: AppConfig) {
    try {
      await putAppConfigSettings(values)
      message.success('已保存 Emby 设置')
      void queryClient.invalidateQueries({ queryKey: appConfigQueryKey })
      void queryClient.invalidateQueries({ queryKey: ['emby-items'] })
      onSaved()
    }
    catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    }
  }

  return (
    <form className="flex flex-col gap-6" onSubmit={form.handleSubmit(handleSubmit)}>
      <EmbyConfigFormGroup control={form.control} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" isPending={form.formState.isSubmitting}>
          保存 Emby 设置
        </Button>
        <Button
          type="button"
          variant="secondary"
          isPending={testConnectionMutation.isPending}
          onPress={() => testConnectionMutation.mutate(undefined)}
        >
          <Icon className="size-4" icon="lucide:plug-zap" />
          测试连接
        </Button>
        {testConnectionMutation.data?.user_id
          ? (
              <Chip size="sm" variant="soft">
                用户 ID 已写入表单
              </Chip>
            )
          : null}
      </div>
    </form>
  )
}

function EmbySettingPage() {
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
          : '加载 Emby 设置失败',
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
        <Card.Title>Emby 设置</Card.Title>
      </Card.Header>
      <Card.Content className="flex flex-col gap-4">
        <p className="m-0 text-sm text-muted">
          Emby 连接信息持久化在本地
          <code className="mx-1 rounded bg-surface-secondary px-1">app_config.json</code>
          。密码与 API Key 留空保存时不覆盖已存密钥。
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
                <EmbyConfigForm
                  key={appConfigFormKey}
                  initialValues={appCfgQuery.data}
                  onSaved={() => appCfgQuery.refetch()}
                />
              )
            : (
                <span className="text-sm text-muted">无法加载 Emby 设置</span>
              )}
      </Card.Content>
    </Card>
  )
}
