import type { SubtitleTranslateConfig, SubtitleTranslateJobReq } from '@/types/api'
import {
  DrawerForm,
  ProFormDigit,
  ProFormGroup,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components'
import { useQuery } from '@tanstack/react-query'
import { App, Checkbox } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import { appConfigQueryKey, enqueueSubtitleTranslate, fetchAppConfig } from '@/request'

export interface SubtitleTranslateTaskCreateDrawerFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

type TranslateFormValues = {
  source_srt_path: string
} & SubtitleTranslateConfig

export function SubtitleTranslateTaskCreateDrawerForm(
  props: SubtitleTranslateTaskCreateDrawerFormProps,
) {
  const { message } = App.useApp()
  const [inheritGlobal, setInheritGlobal] = useState(true)

  const appCfgQuery = useQuery({
    queryKey: appConfigQueryKey,
    queryFn: fetchAppConfig,
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

  const initialValues = useMemo((): Partial<TranslateFormValues> => {
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

  const formKey = appCfgQuery.isSuccess
    ? String(appCfgQuery.dataUpdatedAt)
    : appCfgQuery.isError
      ? 'err'
      : 'pending'

  return (
    <DrawerForm<TranslateFormValues>
      key={formKey}
      title="新增字幕翻译任务"
      open={props.open}
      onOpenChange={(open) => {
        if (open)
          setInheritGlobal(true)
        props.onOpenChange(open)
      }}
      grid
      drawerProps={{ destroyOnClose: true }}
      initialValues={initialValues}
      submitter={{
        searchConfig: { submitText: '提交' },
        submitButtonProps: { disabled: appCfgQuery.isPending },
      }}
      onFinish={async (values) => {
        const source_srt_path = values.source_srt_path.trim()
        if (!source_srt_path) {
          message.error('请输入字幕文件路径')
          return false
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
          await enqueueSubtitleTranslate(body)
          message.success('已提交翻译任务')
          props.onCreated?.()
          return true
        }
        catch (e) {
          message.error((e as Error).message || '提交失败')
          return false
        }
      }}
    >
      <ProFormText
        name="source_srt_path"
        label="源 SRT 路径"
        rules={[{ required: true, message: '请输入字幕文件路径' }]}
      />
      <div className="mb-3">
        <Checkbox checked={inheritGlobal} onChange={e => setInheritGlobal(e.target.checked)}>
          继承全局设置
        </Checkbox>
      </div>
      <ProFormGroup title="翻译配置">
        <ProFormText name="base_url" label="API Base URL" fieldProps={{ disabled: inheritGlobal }} />
        <ProFormText
          name="api_key"
          label="API Key"
          fieldProps={{
            type: 'password',
            autoComplete: 'new-password',
            disabled: inheritGlobal,
          }}
        />
        <ProFormText name="model" label="模型" fieldProps={{ disabled: inheritGlobal }} />
        <ProFormText
          name="target_language"
          label="目标语言"
          rules={inheritGlobal ? [] : [{ required: true, message: '请输入目标语言' }]}
          fieldProps={{ disabled: inheritGlobal }}
        />
        <ProFormDigit
          name="concurrency"
          label="并发数"
          min={1}
          max={32}
          fieldProps={{ precision: 0, disabled: inheritGlobal }}
        />
        <ProFormDigit
          name="batch_size"
          label="批量条数"
          min={1}
          max={64}
          fieldProps={{ precision: 0, disabled: inheritGlobal }}
        />
        <ProFormSwitch
          name="remove_source_srt"
          label="完成后删除原文 SRT"
          fieldProps={{ disabled: inheritGlobal }}
        />
      </ProFormGroup>
    </DrawerForm>
  )
}
