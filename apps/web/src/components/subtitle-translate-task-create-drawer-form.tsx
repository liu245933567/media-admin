import type { SubtitleTranslateConfig, SubtitleTranslateTaskCreateReq } from '@/types/api'
import {
  DrawerForm,
  ProFormDigit,
  ProFormGroup,
  ProFormSwitch,
  ProFormText,
} from '@ant-design/pro-components'
import { App } from 'antd'
import { createSubtitleTranslateTask } from '@/request'

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
    <DrawerForm<SubtitleTranslateTaskCreateReq>
      title="新增字幕翻译任务"
      open={props.open}
      onOpenChange={props.onOpenChange}
      grid
      drawerProps={{ destroyOnClose: true }}
      initialValues={{
        source_srt_path: '',
        config: { ...DEFAULT_TRANSLATE },
      }}
      submitter={{
        searchConfig: { submitText: '提交' },
      }}
      onFinish={async (values) => {
        try {
          const body: SubtitleTranslateTaskCreateReq = {
            source_srt_path: values.source_srt_path.trim(),
            config: values.config,
          }
          await createSubtitleTranslateTask(body)
          message.success('任务已添加')
          props.onCreated?.()
          return true
        }
        catch (e) {
          message.error((e as Error).message || '创建失败')
          return false
        }
      }}
    >
      <ProFormText
        name="source_srt_path"
        label="源 SRT 路径"
        placeholder="请输入磁盘上的 .srt 文件路径"
        rules={[
          { required: true, message: '请输入源 SRT 路径' },
          {
            validator: async (_, v) => {
              if (!v || !String(v).trim())
                throw new Error('请输入源 SRT 路径')
            },
          },
        ]}
      />

      <ProFormGroup title="翻译设置">
        <ProFormText
          name={['config', 'base_url']}
          label="API Base URL"
          placeholder="留空则使用服务端 TRANSLATE_OPENAI_BASE"
          extra="OpenAI 兼容接口根地址。"
          colProps={{ span: 12 }}
        />
        <ProFormText
          name={['config', 'api_key']}
          label="API Key"
          placeholder="留空则使用服务端 TRANSLATE_OPENAI_API_KEY"
          fieldProps={{
            type: 'password',
            autoComplete: 'new-password',
          }}
          colProps={{ span: 12 }}
        />
        <ProFormText
          name={['config', 'target_language']}
          label="目标语言"
          placeholder="例如：Chinese / English / Japanese"
          rules={[{ required: true, message: '请输入目标语言' }]}
          colProps={{ span: 8 }}
        />
        <ProFormText
          name={['config', 'model']}
          label="翻译模型"
          placeholder="例如：tencent/Hunyuan-MT-7B"
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['config', 'concurrency']}
          label="并发数"
          min={1}
          fieldProps={{ precision: 0 }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['config', 'batch_size']}
          label="批大小"
          min={1}
          fieldProps={{ precision: 0 }}
          colProps={{ span: 8 }}
        />
        <ProFormSwitch
          name={['config', 'remove_source_srt']}
          label="翻译完成后删除原文 SRT"
          colProps={{ span: 8 }}
        />
      </ProFormGroup>
    </DrawerForm>
  )
}
