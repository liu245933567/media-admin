import type { SubtitleGenerateConfig } from '@/types/api'
import { DrawerForm, ProFormDependency, ProFormDigit, ProFormGroup, ProFormSelect, ProFormSwitch, ProFormText, ProFormTextArea } from '@ant-design/pro-components'
import { useQuery } from '@tanstack/react-query'
import { App } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import {
  createSubtitleTask,
  fetchSubtitleTaskGenerateDefaults,
  fetchWhisperModels,
  subtitleTaskGenerateDefaultsQueryKey,
  whisperModelsQueryKey,
} from '@/request'

export interface SubtitleTaskCreateDrawerFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

export function SubtitleTaskCreateDrawerForm(props: SubtitleTaskCreateDrawerFormProps) {
  const { message } = App.useApp()

  const defaultsQuery = useQuery({
    queryKey: subtitleTaskGenerateDefaultsQueryKey,
    queryFn: fetchSubtitleTaskGenerateDefaults,
    staleTime: 60 * 60 * 1000,
  })

  useEffect(() => {
    if (defaultsQuery.isError) {
      message.error(
        defaultsQuery.error instanceof Error
          ? defaultsQuery.error.message
          : '加载默认配置失败',
      )
    }
  }, [defaultsQuery.isError, defaultsQuery.error, message])

  const whisperModelsQuery = useQuery({
    queryKey: whisperModelsQueryKey,
    queryFn: fetchWhisperModels,
  })
  const whisperModelFilenameOptions = useMemo(
    () =>
      (whisperModelsQuery.data?.items ?? []).map(m => ({
        label: `${m.label}（${m.filename}）${m.local_ready ? ' · 已就绪' : ''}`,
        value: m.filename,
      })),
    [whisperModelsQuery.data?.items],
  )
  const [enableTranslate, setEnableTranslate] = useState(true)

  const initialValues = useMemo((): Partial<SubtitleGenerateConfig> => {
    const c = defaultsQuery.data?.config
    if (!c)
      return { video_path: '' }
    return {
      ...c,
      video_path: '',
    }
  }, [defaultsQuery.data])

  const formMountKey = defaultsQuery.isSuccess
    ? String(defaultsQuery.dataUpdatedAt)
    : defaultsQuery.isError
      ? 'err'
      : 'pending'

  return (
    <DrawerForm<SubtitleGenerateConfig>
      key={formMountKey}
      title="新增字幕任务"
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open)
      }}
      grid
      drawerProps={{ destroyOnClose: true }}
      initialValues={initialValues}
      submitter={{
        searchConfig: { submitText: '提交' },
        submitButtonProps: { disabled: defaultsQuery.isPending },
      }}
      onFinish={async (values) => {
        try {
          const config: SubtitleGenerateConfig = {
            ...values,
            video_path: values.video_path.trim(),
            translate_cfg: enableTranslate ? values.translate_cfg : undefined,
          }

          await createSubtitleTask({ config })
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
        name="video_path"
        label="视频路径"
        placeholder="请输入视频路径"
        rules={[
          { required: true, message: '请输入视频路径' },
          {
            validator: async (_, v) => {
              if (!v || !String(v).trim())
                throw new Error('请输入视频路径')
            },
          },
        ]}
      />

      <ProFormGroup title="VAD 配置">
        <ProFormDigit
          name={['vad_config', 'frame_ms']}
          label="帧长(ms)"
          min={10}
          max={30}
          fieldProps={{ precision: 0 }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['vad_config', 'mode']}
          label="模式(0-3)"
          min={0}
          max={3}
          fieldProps={{ precision: 0 }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['vad_config', 'padding_ms']}
          label="Padding(ms)"
          min={0}
          fieldProps={{ precision: 0 }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['vad_config', 'min_speech_ms']}
          label="最短语音段(ms)"
          min={0}
          fieldProps={{ precision: 0 }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['vad_config', 'max_segment_ms']}
          label="单段最大长度(ms)"
          min={0}
          fieldProps={{ precision: 0 }}
          colProps={{ span: 8 }}
        />
      </ProFormGroup>

      <ProFormGroup title="Whisper 引擎配置">
        <ProFormSelect
          name={['whisper_engine_cfg', 'model_filename']}
          label="模型文件"
          placeholder="请选择模型文件"
          rules={[{ required: true, message: '请选择模型文件' }]}
          options={whisperModelFilenameOptions}
          fieldProps={{
            showSearch: true,
            loading: whisperModelsQuery.isPending,
            optionFilterProp: 'label',
          }}
          colProps={{ span: 12 }}
        />
        <ProFormSwitch
          name={['whisper_engine_cfg', 'use_gpu']}
          label="使用 GPU"
          colProps={{ span: 6 }}
        />
        <ProFormSwitch
          name={['whisper_engine_cfg', 'flash_attn']}
          label="启用 Flash Attention"
          colProps={{ span: 6 }}
        />
      </ProFormGroup>

      <ProFormGroup title="Whisper 识别参数">
        <ProFormText
          name={['whisper_transcribe_options', 'language']}
          label="语言代码"
          placeholder="留空表示 None；可填 auto / zh / en ..."
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['whisper_transcribe_options', 'beam_size']}
          label="beam_size"
          min={1}
          fieldProps={{ precision: 0 }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['whisper_transcribe_options', 'greedy_best_of']}
          label="greedy_best_of"
          min={1}
          fieldProps={{ precision: 0 }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['whisper_transcribe_options', 'n_threads']}
          label="CPU 线程数"
          min={0}
          fieldProps={{ precision: 0 }}
          colProps={{ span: 8 }}
        />
        <ProFormSwitch
          name={['whisper_transcribe_options', 'auto_gain']}
          label="自动增益"
          colProps={{ span: 8 }}
        />
        <ProFormSwitch
          name={['whisper_transcribe_options', 'anti_hallucination']}
          label="抗幻觉参数组合"
          colProps={{ span: 8 }}
        />
        <ProFormTextArea
          name={['whisper_transcribe_options', 'initial_prompt']}
          label="初始 Prompt"
          placeholder="可选：专有名词、人名、风格示例等"
          fieldProps={{ autoSize: { minRows: 2, maxRows: 6 } }}
        />

      </ProFormGroup>

      <ProFormSwitch
        label="启用翻译"
        fieldProps={{
          checked: enableTranslate,
          onChange: checked => setEnableTranslate(Boolean(checked)),
        }}
        colProps={{ span: 8 }}
      />

      <ProFormDependency name={['translate_cfg']}>
        {() => {
          if (!enableTranslate)
            return null

          return (
            <ProFormGroup title="翻译设置">
              <ProFormText
                name={['translate_cfg', 'base_url']}
                label="API Base URL"
                placeholder="留空则使用服务端 TRANSLATE_OPENAI_BASE"
                extra="OpenAI 兼容接口根地址，默认与硅基流动一致时可保留表单默认值。"
                colProps={{ span: 12 }}
              />
              <ProFormText
                name={['translate_cfg', 'api_key']}
                label="API Key"
                placeholder="留空则使用服务端 TRANSLATE_OPENAI_API_KEY"
                fieldProps={{
                  type: 'password',
                  autoComplete: 'new-password',
                }}
                extra="仅在任务中填写；不会回显已保存的密钥，编辑任务时请按需重新填写。"
                colProps={{ span: 12 }}
              />
              <ProFormText
                name={['translate_cfg', 'target_language']}
                label="目标语言"
                placeholder="例如：Chinese / English / Japanese"
                rules={[{ required: true, message: '请输入目标语言' }]}
                colProps={{ span: 8 }}
              />
              <ProFormText
                name={['translate_cfg', 'model']}
                label="翻译模型"
                placeholder="例如：tencent/Hunyuan-MT-7B"
                colProps={{ span: 8 }}
              />
              <ProFormDigit
                name={['translate_cfg', 'concurrency']}
                label="并发数"
                min={1}
                fieldProps={{ precision: 0 }}
                colProps={{ span: 8 }}
              />
              <ProFormDigit
                name={['translate_cfg', 'batch_size']}
                label="批大小"
                min={1}
                fieldProps={{ precision: 0 }}
                colProps={{ span: 8 }}
              />
              <ProFormSwitch
                name={['translate_cfg', 'remove_source_srt']}
                label="翻译完成后删除原文 SRT"
                colProps={{ span: 8 }}
              />
            </ProFormGroup>

          )
        }}
      </ProFormDependency>

    </DrawerForm>
  )
}
