import type { Control, FieldValues } from 'react-hook-form'
import { RhfTextField } from './rhf-heroui-fields'

export interface StashConfigFormGroupProps<TFieldValues extends FieldValues = FieldValues> {
  control: Control<TFieldValues>
  variant?: 'setting' | 'task'
}

export function StashConfigFormGroup<TFieldValues extends FieldValues>({
  control,
  variant = 'setting',
}: StashConfigFormGroupProps<TFieldValues>) {
  const apiKeyPlaceholder
    = variant === 'setting' ? '留空则保存时不覆盖已存 ApiKey' : undefined
  const apiKeyExtra
    = variant === 'setting'
      ? '设置页保存时若留空，将保留已保存的 Stash ApiKey。'
      : undefined

  return (
    <section className="flex flex-col gap-4">
      <h3 className="m-0 text-base font-semibold">Stash 连接</h3>
      <div className="grid gap-4 md:grid-cols-2">
        <RhfTextField
          control={control}
          name={'stash_config.base_url' as never}
          label="Base URL"
          placeholder="http://127.0.0.1:9999"
          description="Stash 实例根地址，无需带 /graphql 后缀。"
        />
        <RhfTextField
          control={control}
          name={'stash_config.api_key' as never}
          label="ApiKey"
          placeholder={apiKeyPlaceholder}
          type="password"
          description={apiKeyExtra}
        />
      </div>
    </section>
  )
}
