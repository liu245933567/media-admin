import type { SubtitleTranslateConfig, SubtitleTranslateJobReq } from '@/api'
import { Button, Checkbox, Drawer, Label } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  getAppConfigSettings,
  getGetAppConfigSettingsQueryKey,
  translateJobs,
} from '@/api'
import { useAppToast } from './app-toast'
import {
  RhfNumberField,
  RhfSwitchField,
  RhfTextField,
} from './rhf-heroui-fields'

export interface SubtitleTranslateTaskCreateDrawerFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

type TranslateFormValues = {
  source_srt_path: string
} & SubtitleTranslateConfig

const translateFormSchema = z.object({
  source_srt_path: z.string().min(1, '请输入字幕文件路径'),
  base_url: z.string(),
  api_key: z.string(),
  model: z.string(),
  target_language: z.string(),
  concurrency: z.number().min(1),
  batch_size: z.number().min(1),
  remove_source_srt: z.boolean(),
})

export function SubtitleTranslateTaskCreateDrawerForm(
  props: SubtitleTranslateTaskCreateDrawerFormProps,
) {
  const message = useAppToast()
  const [inheritGlobal, setInheritGlobal] = useState(true)

  const form = useForm<TranslateFormValues>({
    defaultValues: {
      source_srt_path: '',
      base_url: '',
      api_key: '',
      model: '',
      target_language: 'Chinese',
      concurrency: 4,
      batch_size: 8,
      remove_source_srt: false,
    },
  })

  const appCfgQuery = useQuery({
    queryKey: getGetAppConfigSettingsQueryKey(),
    queryFn: getAppConfigSettings,
    enabled: props.open,
    staleTime: 60 * 1000,
  })

  useEffect(() => {
    if (appCfgQuery.isError) {
      message.error(
        appCfgQuery.error instanceof Error
          ? appCfgQuery.error.message
          : '加载全局翻译配置失败',
      )
    }
  }, [appCfgQuery.isError, appCfgQuery.error, message])

  const initialValues = useMemo((): TranslateFormValues => {
    const t = appCfgQuery.data?.translate_config
    return {
      source_srt_path: '',
      base_url: t?.base_url ?? '',
      api_key: '',
      model: t?.model ?? '',
      target_language: t?.target_language ?? 'Chinese',
      concurrency: t?.concurrency ?? 4,
      batch_size: t?.batch_size ?? 8,
      remove_source_srt: t?.remove_source_srt ?? false,
    }
  }, [appCfgQuery.data])

  useEffect(() => {
    if (props.open) {
      setInheritGlobal(true)
      form.reset(initialValues)
    }
  }, [form, initialValues, props.open])

  async function handleSubmit(values: TranslateFormValues) {
    const parsed = translateFormSchema.safeParse(values)
    if (!parsed.success) {
      message.error(parsed.error.issues[0]?.message ?? '表单校验失败')
      return
    }
    const source_srt_path = values.source_srt_path.trim()
    if (!source_srt_path) {
      message.error('请输入字幕文件路径')
      return
    }
    const body: SubtitleTranslateJobReq = inheritGlobal
      ? { source_srt_path, config: undefined }
      : {
          source_srt_path,
          config: {
            base_url: values.base_url ?? '',
            api_key: values.api_key ?? '',
            model: values.model ?? '',
            target_language: values.target_language ?? '',
            concurrency: values.concurrency ?? 4,
            batch_size: values.batch_size ?? 8,
            remove_source_srt: values.remove_source_srt ?? false,
          },
        }
    try {
      await translateJobs(body)
      message.success('已提交翻译任务')
      props.onCreated?.()
      props.onOpenChange(false)
    }
    catch (e) {
      message.error((e as Error).message || '提交失败')
    }
  }

  return (
    <Drawer.Backdrop isOpen={props.open} onOpenChange={props.onOpenChange}>
      <Drawer.Content placement="right" className="sm:max-w-190">
        <Drawer.Dialog>
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>新增字幕翻译任务</Drawer.Heading>
          </Drawer.Header>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <Drawer.Body>
              <div className="flex flex-col gap-5">
                <RhfTextField
                  control={form.control}
                  name="source_srt_path"
                  label="源 SRT 路径"
                  placeholder="请输入字幕文件路径"
                />
                <Checkbox
                  isSelected={inheritGlobal}
                  onChange={setInheritGlobal}
                >
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Checkbox.Content>
                    <Label>继承全局设置</Label>
                  </Checkbox.Content>
                </Checkbox>
                <section className="flex flex-col gap-4">
                  <h3 className="m-0 text-base font-semibold">翻译配置</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <RhfTextField
                      control={form.control}
                      name="base_url"
                      label="API Base URL"
                      disabled={inheritGlobal}
                    />
                    <RhfTextField
                      control={form.control}
                      name="api_key"
                      label="API Key"
                      type="password"
                      disabled={inheritGlobal}
                    />
                    <RhfTextField
                      control={form.control}
                      name="model"
                      label="模型"
                      disabled={inheritGlobal}
                    />
                    <RhfTextField
                      control={form.control}
                      name="target_language"
                      label="目标语言"
                      disabled={inheritGlobal}
                    />
                    <RhfNumberField
                      control={form.control}
                      name="concurrency"
                      label="并发数"
                      minValue={1}
                      maxValue={32}
                      disabled={inheritGlobal}
                      variant="secondary"
                    />
                    <RhfNumberField
                      control={form.control}
                      name="batch_size"
                      label="批量条数"
                      minValue={1}
                      maxValue={64}
                      disabled={inheritGlobal}
                      variant="secondary"
                    />
                    <RhfSwitchField
                      control={form.control}
                      name="remove_source_srt"
                      label="完成后删除原文 SRT"
                      disabled={inheritGlobal}
                    />
                  </div>
                </section>
              </div>
            </Drawer.Body>
            <Drawer.Footer>
              <Button
                variant="secondary"
                onPress={() => props.onOpenChange(false)}
              >
                取消
              </Button>
              <Button
                type="submit"
                isDisabled={appCfgQuery.isPending}
                isPending={form.formState.isSubmitting}
              >
                提交
              </Button>
            </Drawer.Footer>
          </form>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  )
}
