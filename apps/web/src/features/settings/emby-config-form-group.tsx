import type { Control, FieldValues } from 'react-hook-form'
import { RhfTextField } from '@/components/rhf-heroui-fields'

export interface EmbyConfigFormGroupProps<TFieldValues extends FieldValues = FieldValues> {
  control: Control<TFieldValues>
}

export function EmbyConfigFormGroup<TFieldValues extends FieldValues>({
  control,
}: EmbyConfigFormGroupProps<TFieldValues>) {
  return (
    <section className="flex flex-col gap-4">
      <h3 className="m-0 text-base font-semibold">Emby 连接</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <RhfTextField
          control={control}
          name={'emby_config.base_url' as never}
          label="Base URL"
          placeholder="http://127.0.0.1:8096"
          description="Emby 实例根地址。"
        />
        <RhfTextField
          control={control}
          name={'emby_config.username' as never}
          label="用户名"
          placeholder="Emby 用户名"
          description="未填写 API Key 时使用用户名密码登录。"
        />
        <RhfTextField
          control={control}
          name={'emby_config.password' as never}
          label="密码"
          placeholder="留空则保存时不覆盖已存密码"
          type="password"
          description="设置页保存时若留空，将保留已保存的 Emby 密码。"
        />
        <RhfTextField
          control={control}
          name={'emby_config.api_key' as never}
          label="API Key"
          placeholder="留空则使用用户名密码"
          type="password"
          description="填写 API Key 后优先使用 API Key 访问；可通过用户名自动解析用户 ID。"
        />
        <RhfTextField
          control={control}
          name={'emby_config.user_id' as never}
          label="用户 ID"
          placeholder="可留空"
          description="使用 API Key 时可手动指定；留空则按用户名查找。"
        />
      </div>
    </section>
  )
}
