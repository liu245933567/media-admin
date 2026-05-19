import type { ReactNode } from 'react'
import {
  ProFormDigit,
  ProFormGroup,
  ProFormSelect,
  ProFormSwitch,
  ProFormText,
  ProFormTextArea,
} from '@ant-design/pro-components'
import { Space, Switch, Typography } from 'antd'

export interface WhisperModelOption {
  label: string
  value: string
}

export interface SubtitlePipelineFormGroupsProps {
  whisperModelFilenameOptions: WhisperModelOption[]
  whisperModelsLoading?: boolean
  /** 是否渲染翻译参数分组 */
  showTranslateGroup: boolean
  /** 为 true 时对应分组表单项 `disabled`（继承全局时由父组件控制） */
  disabledVad?: boolean
  disabledWhisperEngine?: boolean
  disabledWhisperTranscribe?: boolean
  disabledTranslate?: boolean
  /** 与「继承全局」开关联动：展示在分组标题旁 */
  inheritVad?: boolean
  onInheritVadChange?: (v: boolean) => void
  inheritWhisperEngine?: boolean
  onInheritWhisperEngineChange?: (v: boolean) => void
  inheritWhisperTranscribe?: boolean
  onInheritWhisperTranscribeChange?: (v: boolean) => void
  inheritTranslate?: boolean
  onInheritTranslateChange?: (v: boolean) => void
  /** 设置页保存文案与任务表单略有不同 */
  variant?: 'setting' | 'task'
  /** 插在「识别参数」与「翻译设置」之间，例如任务表单的「启用翻译」勾选 */
  translateToggleSlot?: ReactNode
}

function GroupTitleWithInherit(props: {
  title: string
  inherit?: boolean
  onInheritChange?: (v: boolean) => void
}) {
  if (props.onInheritChange === undefined)
    return <span>{props.title}</span>
  return (
    <Space align="center" wrap>
      <span>{props.title}</span>
      <Space size="small" align="center">
        <Switch checked={props.inherit} onChange={props.onInheritChange} size="small" />
        <Typography.Text type="secondary" className="text-xs">
          继承全局设置
        </Typography.Text>
      </Space>
    </Space>
  )
}

export function SubtitlePipelineFormGroups(props: SubtitlePipelineFormGroupsProps) {
  const v = props.variant ?? 'task'
  const apiKeyPlaceholder
    = v === 'setting' ? '留空则保存时不覆盖已存密钥' : '留空则使用服务端 TRANSLATE_OPENAI_API_KEY'
  const apiKeyExtra
    = v === 'setting'
      ? '设置页保存时若留空，将保留数据库中已保存的 API Key。'
      : '仅在任务中填写；不会回显已保存的密钥，编辑任务时请按需重新填写。'

  const engineRules = props.disabledWhisperEngine
    ? []
    : [{ required: true, message: '请选择模型文件' }]

  const translateTargetRules = props.disabledTranslate
    ? []
    : [{ required: true, message: '请输入目标语言' }]

  return (
    <>
      <ProFormGroup
        title={(
          <GroupTitleWithInherit
            title="VAD 配置"
            inherit={props.inheritVad}
            onInheritChange={props.onInheritVadChange}
          />
        )}
      >
        <ProFormDigit
          name={['vad_config', 'frame_ms']}
          label="帧长(ms)"
          min={10}
          max={30}
          fieldProps={{ precision: 0, disabled: props.disabledVad }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['vad_config', 'mode']}
          label="模式(0-3)"
          min={0}
          max={3}
          fieldProps={{ precision: 0, disabled: props.disabledVad }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['vad_config', 'padding_ms']}
          label="Padding(ms)"
          min={0}
          fieldProps={{ precision: 0, disabled: props.disabledVad }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['vad_config', 'min_speech_ms']}
          label="最短语音段(ms)"
          min={0}
          fieldProps={{ precision: 0, disabled: props.disabledVad }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['vad_config', 'max_segment_ms']}
          label="单段最大长度(ms)"
          min={0}
          fieldProps={{ precision: 0, disabled: props.disabledVad }}
          colProps={{ span: 8 }}
        />
      </ProFormGroup>

      <ProFormGroup
        title={(
          <GroupTitleWithInherit
            title="Whisper 引擎配置"
            inherit={props.inheritWhisperEngine}
            onInheritChange={props.onInheritWhisperEngineChange}
          />
        )}
      >
        <ProFormSelect
          name={['whisper_engine_config', 'model_filename']}
          label="模型文件"
          placeholder="请选择模型文件"
          rules={engineRules}
          options={props.whisperModelFilenameOptions}
          fieldProps={{
            showSearch: true,
            loading: props.whisperModelsLoading,
            optionFilterProp: 'label',
            disabled: props.disabledWhisperEngine,
          }}
          colProps={{ span: 12 }}
        />
        <ProFormSwitch
          name={['whisper_engine_config', 'use_gpu']}
          label="使用 GPU"
          fieldProps={{ disabled: props.disabledWhisperEngine }}
          colProps={{ span: 6 }}
        />
        <ProFormSwitch
          name={['whisper_engine_config', 'flash_attn']}
          label="启用 Flash Attention"
          fieldProps={{ disabled: props.disabledWhisperEngine }}
          colProps={{ span: 6 }}
        />
      </ProFormGroup>

      <ProFormGroup
        title={(
          <GroupTitleWithInherit
            title="Whisper 识别参数"
            inherit={props.inheritWhisperTranscribe}
            onInheritChange={props.onInheritWhisperTranscribeChange}
          />
        )}
      >
        <ProFormText
          name={['whisper_transcribe_config', 'language']}
          label="语言代码"
          placeholder="留空表示 None；可填 auto / zh / en ..."
          fieldProps={{ disabled: props.disabledWhisperTranscribe }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['whisper_transcribe_config', 'beam_size']}
          label="beam_size"
          min={1}
          fieldProps={{ precision: 0, disabled: props.disabledWhisperTranscribe }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['whisper_transcribe_config', 'greedy_best_of']}
          label="greedy_best_of"
          min={1}
          fieldProps={{ precision: 0, disabled: props.disabledWhisperTranscribe }}
          colProps={{ span: 8 }}
        />
        <ProFormDigit
          name={['whisper_transcribe_config', 'n_threads']}
          label="CPU 线程数"
          min={0}
          fieldProps={{ precision: 0, disabled: props.disabledWhisperTranscribe }}
          colProps={{ span: 8 }}
        />
        <ProFormSwitch
          name={['whisper_transcribe_config', 'auto_gain']}
          label="自动增益"
          fieldProps={{ disabled: props.disabledWhisperTranscribe }}
          colProps={{ span: 8 }}
        />
        <ProFormSwitch
          name={['whisper_transcribe_config', 'anti_hallucination']}
          label="抗幻觉参数组合"
          fieldProps={{ disabled: props.disabledWhisperTranscribe }}
          colProps={{ span: 8 }}
        />
        <ProFormTextArea
          name={['whisper_transcribe_config', 'initial_prompt']}
          label="初始 Prompt"
          placeholder="可选：专有名词、人名、风格示例等"
          fieldProps={{ autoSize: { minRows: 2, maxRows: 6 }, disabled: props.disabledWhisperTranscribe }}
        />
      </ProFormGroup>

      {props.translateToggleSlot !== undefined && props.translateToggleSlot !== null
        ? <div className="my-3">{props.translateToggleSlot}</div>
        : null}

      {props.showTranslateGroup
        ? (
            <ProFormGroup
              title={(
                <GroupTitleWithInherit
                  title="翻译设置"
                  inherit={props.inheritTranslate}
                  onInheritChange={props.onInheritTranslateChange}
                />
              )}
            >
              <ProFormText
                name={['translate_config', 'base_url']}
                label="API Base URL"
                placeholder="留空则使用服务端 TRANSLATE_OPENAI_BASE"
                extra="OpenAI 兼容接口根地址，默认与硅基流动一致时可保留表单默认值。"
                fieldProps={{ disabled: props.disabledTranslate }}
                colProps={{ span: 12 }}
              />
              <ProFormText
                name={['translate_config', 'api_key']}
                label="API Key"
                placeholder={apiKeyPlaceholder}
                fieldProps={{
                  type: 'password',
                  autoComplete: 'new-password',
                  disabled: props.disabledTranslate,
                }}
                extra={apiKeyExtra}
                colProps={{ span: 12 }}
              />
              <ProFormText
                name={['translate_config', 'target_language']}
                label="目标语言"
                placeholder="例如：Chinese / English / Japanese"
                rules={translateTargetRules}
                fieldProps={{ disabled: props.disabledTranslate }}
                colProps={{ span: 8 }}
              />
              <ProFormText
                name={['translate_config', 'model']}
                label="翻译模型"
                placeholder="例如：tencent/Hunyuan-MT-7B"
                fieldProps={{ disabled: props.disabledTranslate }}
                colProps={{ span: 8 }}
              />
              <ProFormDigit
                name={['translate_config', 'concurrency']}
                label="并发数"
                min={1}
                fieldProps={{ precision: 0, disabled: props.disabledTranslate }}
                colProps={{ span: 8 }}
              />
              <ProFormDigit
                name={['translate_config', 'batch_size']}
                label="批大小"
                min={1}
                fieldProps={{ precision: 0, disabled: props.disabledTranslate }}
                colProps={{ span: 8 }}
              />
              <ProFormSwitch
                name={['translate_config', 'remove_source_srt']}
                label="翻译完成后删除原文 SRT"
                fieldProps={{ disabled: props.disabledTranslate }}
                colProps={{ span: 8 }}
              />
            </ProFormGroup>
          )
        : null}
    </>
  )
}
