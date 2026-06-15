import type { Control, FieldValues } from 'react-hook-form'
import { Button, Surface } from '@heroui/react'
import { Icon } from '@iconify/react'
import { useFieldArray } from 'react-hook-form'
import { RhfTextField } from '@/components/rhf-heroui-fields'

export interface StashConfigFormGroupProps<TFieldValues extends FieldValues = FieldValues> {
  control: Control<TFieldValues>
  variant?: 'setting' | 'task'
}

export function StashConfigFormGroup<TFieldValues extends FieldValues>({
  control,
  variant = 'setting',
}: StashConfigFormGroupProps<TFieldValues>) {
  const pathMappings = useFieldArray({
    control,
    name: 'stash_config.path_mappings' as never,
  })
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
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h4 className="m-0 text-sm font-medium">文件路径映射</h4>
            <p className="m-0 mt-1 text-xs text-muted">
              Stash 与本服务访问同一套磁盘但路径前缀不一致时使用。
            </p>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onPress={() => pathMappings.append({ stash_prefix: '', local_prefix: '' } as never)}
          >
            <Icon className="size-4" icon="lucide:plus" />
            添加
          </Button>
        </div>
        {pathMappings.fields.length > 0 && (
          <div className="flex flex-col gap-2">
            {pathMappings.fields.map((field, index) => (
              <Surface key={field.id} className="grid gap-3 rounded-lg p-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]" variant="secondary">
                <RhfTextField
                  control={control}
                  name={`stash_config.path_mappings.${index}.stash_prefix` as never}
                  label="Stash 路径前缀"
                  placeholder="/data/media"
                />
                <RhfTextField
                  control={control}
                  name={`stash_config.path_mappings.${index}.local_prefix` as never}
                  label="本地路径前缀"
                  placeholder="D:\\media"
                />
                <Button
                  isIconOnly
                  aria-label="删除路径映射"
                  className="self-end"
                  size="sm"
                  variant="danger-soft"
                  onPress={() => pathMappings.remove(index)}
                >
                  <Icon className="size-4" icon="lucide:trash-2" />
                </Button>
              </Surface>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
