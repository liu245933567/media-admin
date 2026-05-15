import type { SubtitleTranslateConfig, SubtitleTranslateJob } from '@/types/api'
import {
  DrawerForm,
  ProFormDigit,
  ProFormGroup,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components'
import { App } from 'antd'
import { enqueueSubtitleTranslate } from '@/request'

const DEFAULT_TRANSLATE: SubtitleTranslateConfig = {
  base_url: 'https://api.siliconflow.com/v1',
  api_key: '',
  model: 'tencent/Hunyuan-MT-7B',
  target_language: 'Chinese',
  concurrency: 4,
  batch_size: 8,
  remove_source_srt: false,
}

export interface SubtitleTranslateTaskCreateDrawerFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

export function SubtitleTranslateTaskCreateDrawerForm(
  props: SubtitleTranslateTaskCreateDrawerFormProps,
) {
  const { message } = App.useApp()

  return (
    <DrawerForm<SubtitleTranslateJob>
      title="新增字幕翻译任务"
      open={props.open}
      onOpenChange={props.onOpenChange}
      grid
      drawerProps={{ destroyOnClose: true }}
      initialValues={{
        source_srt_path: '',
        config: DEFAULT_TRANSLATE,
      }}
      onFinish={async (values) => {
        const body: SubtitleTranslateJob = {
          source_srt_path: values.source_srt_path.trim(),
          config: values.config,
        }
        await enqueueSubtitleTranslate(body)
        message.success('已提交翻译任务')
        props.onCreated?.()
        return true
      }}
    >
      <ProFormText
        name="source_srt_path"
        label="源 SRT 路径"
        rules={[{ required: true, message: '请输入字幕文件路径' }]}
      />
      <ProFormGroup title="翻译配置">
        <ProFormText name={['config', 'base_url']} label="API Base URL" />
        <ProFormText.Password name={['config', 'api_key']} label="API Key" />
        <ProFormText name={['config', 'model']} label="模型" />
        <ProFormText name={['config', 'target_language']} label="目标语言" />
        <ProFormDigit name={['config', 'concurrency']} label="并发数" min={1} max={32} />
        <ProFormDigit name={['config', 'batch_size']} label="批量条数" min={1} max={64} />
        <ProFormSwitch name={['config', 'remove_source_srt']} label="完成后删除原文 SRT" />
      </ProFormGroup>
    </DrawerForm>
  )
}
