import type { SubtitleGenerateConfig } from '@/types/api'
import { DrawerForm, ProFormDependency, ProFormDigit, ProFormGroup, ProFormSwitch, ProFormText, ProFormTextArea } from '@ant-design/pro-components'
import { App, Divider } from 'antd'
import { useMemo, useState } from 'react'
import { createSubtitleTask } from '@/request'

export interface SubtitleTaskCreateDrawerFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

export function SubtitleTaskCreateDrawerForm(props: SubtitleTaskCreateDrawerFormProps) {
  const { message } = App.useApp()
  const [enableVadConfig, setEnableVadConfig] = useState(false)
  const [enableWhisperEngineCfg, setEnableWhisperEngineCfg] = useState(false)
  const [enableWhisperTranscribeOptions, setEnableWhisperTranscribeOptions] = useState(false)
  const [enableTranslate, setEnableTranslate] = useState(false)

  const vadDefaults = useMemo(() => {
    return {
      frame_ms: 30,
      mode: 2,
      padding_ms: 300,
      min_speech_ms: 200,
      max_segment_ms: 30000,
    }
  }, [])

  const whisperEngineDefaults = useMemo(() => {
    return {
      model_filename: '',
      use_gpu: true,
      flash_attn: true,
    }
  }, [])

  const whisperTranscribeDefaults = useMemo(() => {
    return {
      beam_size: 1,
      greedy_best_of: 1,
      n_threads: 0,
      auto_gain: false,
      anti_hallucination: false,
    }
  }, [])

  const translateDefaults = useMemo(() => {
    return {
      model: 'tencent/Hunyuan-MT-7B',
      target_language: 'Chinese',
      concurrency: 4,
      batch_size: 8,
      remove_source_srt: false,
    }
  }, [])

  return (
    <DrawerForm<SubtitleGenerateConfig>
      title="新增字幕任务"
      open={props.open}
      onOpenChange={(open) => {
        props.onOpenChange(open)
        if (!open) {
          setEnableVadConfig(false)
          setEnableWhisperEngineCfg(false)
          setEnableWhisperTranscribeOptions(false)
          setEnableTranslate(false)
        }
      }}
      drawerProps={{ destroyOnClose: true }}
      submitter={{ searchConfig: { submitText: '提交' } }}
      onFinish={async (values) => {
        try {
          const config: SubtitleGenerateConfig = {
            ...values,
            video_path: values.video_path.trim(),
            vad_config: enableVadConfig ? values.vad_config : undefined,
            whisper_engine_cfg: enableWhisperEngineCfg ? values.whisper_engine_cfg : undefined,
            whisper_transcribe_options: enableWhisperTranscribeOptions ? values.whisper_transcribe_options : undefined,
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

      <Divider className="my-3" />

      <ProFormSwitch
        label="启用 VAD 配置"
        fieldProps={{
          checked: enableVadConfig,
          onChange: checked => setEnableVadConfig(Boolean(checked)),
        }}
      />
      <ProFormDependency name={['vad_config']}>
        {() => {
          if (!enableVadConfig)
            return null

          return (
            <ProFormGroup title="VAD 配置">
              <ProFormDigit
                name={['vad_config', 'frame_ms']}
                label="帧长(ms)"
                min={10}
                max={30}
                initialValue={vadDefaults.frame_ms}
                fieldProps={{ precision: 0 }}
              />
              <ProFormDigit
                name={['vad_config', 'mode']}
                label="模式(0-3)"
                min={0}
                max={3}
                initialValue={vadDefaults.mode}
                fieldProps={{ precision: 0 }}
              />
              <ProFormDigit
                name={['vad_config', 'padding_ms']}
                label="Padding(ms)"
                min={0}
                initialValue={vadDefaults.padding_ms}
                fieldProps={{ precision: 0 }}
              />
              <ProFormDigit
                name={['vad_config', 'min_speech_ms']}
                label="最短语音段(ms)"
                min={0}
                initialValue={vadDefaults.min_speech_ms}
                fieldProps={{ precision: 0 }}
              />
              <ProFormDigit
                name={['vad_config', 'max_segment_ms']}
                label="单段最大长度(ms)"
                min={0}
                initialValue={vadDefaults.max_segment_ms}
                fieldProps={{ precision: 0 }}
              />
            </ProFormGroup>
          )
        }}
      </ProFormDependency>

      <Divider className="my-3" />

      <ProFormSwitch
        label="启用 Whisper 引擎配置"
        fieldProps={{
          checked: enableWhisperEngineCfg,
          onChange: checked => setEnableWhisperEngineCfg(Boolean(checked)),
        }}
      />
      <ProFormDependency name={['whisper_engine_cfg']}>
        {() => {
          if (!enableWhisperEngineCfg)
            return null

          return (
            <ProFormGroup title="Whisper 引擎配置">
              <ProFormText
                name={['whisper_engine_cfg', 'model_filename']}
                label="模型文件名"
                placeholder="例如：ggml-large-v3.bin"
                initialValue={whisperEngineDefaults.model_filename}
                rules={[{ required: true, message: '请输入模型文件名' }]}
              />
              <ProFormSwitch
                name={['whisper_engine_cfg', 'use_gpu']}
                label="使用 GPU"
                initialValue={whisperEngineDefaults.use_gpu}
              />
              <ProFormSwitch
                name={['whisper_engine_cfg', 'flash_attn']}
                label="启用 flash attention"
                initialValue={whisperEngineDefaults.flash_attn}
              />
            </ProFormGroup>
          )
        }}
      </ProFormDependency>

      <Divider className="my-3" />

      <ProFormSwitch
        label="启用 Whisper 识别参数"
        fieldProps={{
          checked: enableWhisperTranscribeOptions,
          onChange: checked => setEnableWhisperTranscribeOptions(Boolean(checked)),
        }}
      />
      <ProFormDependency name={['whisper_transcribe_options']}>
        {() => {
          if (!enableWhisperTranscribeOptions)
            return null

          return (
            <>
              <ProFormGroup title="Whisper 识别参数">
                <ProFormText
                  name={['whisper_transcribe_options', 'language']}
                  label="语言代码"
                  placeholder="留空表示 None；可填 auto / zh / en ..."
                />
                <ProFormTextArea
                  name={['whisper_transcribe_options', 'initial_prompt']}
                  label="初始 Prompt"
                  placeholder="可选：专有名词、人名、风格示例等"
                  fieldProps={{ autoSize: { minRows: 2, maxRows: 6 } }}
                />
              </ProFormGroup>
              <ProFormGroup>
                <ProFormDigit
                  name={['whisper_transcribe_options', 'beam_size']}
                  label="beam_size"
                  min={1}
                  initialValue={whisperTranscribeDefaults.beam_size}
                  fieldProps={{ precision: 0 }}
                />
                <ProFormDigit
                  name={['whisper_transcribe_options', 'greedy_best_of']}
                  label="greedy_best_of"
                  min={1}
                  initialValue={whisperTranscribeDefaults.greedy_best_of}
                  fieldProps={{ precision: 0 }}
                />
                <ProFormDigit
                  name={['whisper_transcribe_options', 'n_threads']}
                  label="CPU 线程数"
                  min={0}
                  initialValue={whisperTranscribeDefaults.n_threads}
                  fieldProps={{ precision: 0 }}
                />
              </ProFormGroup>
              <ProFormGroup>
                <ProFormSwitch
                  name={['whisper_transcribe_options', 'auto_gain']}
                  label="自动增益"
                  initialValue={whisperTranscribeDefaults.auto_gain}
                />
                <ProFormSwitch
                  name={['whisper_transcribe_options', 'anti_hallucination']}
                  label="抗幻觉参数组合"
                  initialValue={whisperTranscribeDefaults.anti_hallucination}
                />
              </ProFormGroup>
            </>
          )
        }}
      </ProFormDependency>

      <Divider className="my-3" />

      <ProFormSwitch
        label="启用翻译"
        fieldProps={{
          checked: enableTranslate,
          onChange: checked => setEnableTranslate(Boolean(checked)),
        }}
      />

      <ProFormDependency name={['translate_cfg']}>
        {() => {
          if (!enableTranslate)
            return null

          return (
            <>
              <ProFormText
                name={['translate_cfg', 'target_language']}
                label="目标语言"
                placeholder="例如：Chinese / English / Japanese"
                initialValue={translateDefaults.target_language}
                rules={[{ required: true, message: '请输入目标语言' }]}
              />
              <ProFormText
                name={['translate_cfg', 'model']}
                label="翻译模型"
                placeholder="例如：tencent/Hunyuan-MT-7B"
                initialValue={translateDefaults.model}
              />
              <ProFormGroup>
                <ProFormDigit
                  name={['translate_cfg', 'concurrency']}
                  label="并发数"
                  min={1}
                  initialValue={translateDefaults.concurrency}
                  fieldProps={{ precision: 0 }}
                />
                <ProFormDigit
                  name={['translate_cfg', 'batch_size']}
                  label="批大小"
                  min={1}
                  initialValue={translateDefaults.batch_size}
                  fieldProps={{ precision: 0 }}
                />
              </ProFormGroup>
              <ProFormSwitch
                name={['translate_cfg', 'remove_source_srt']}
                label="翻译完成后删除原文 SRT"
                initialValue={translateDefaults.remove_source_srt}
              />
            </>
          )
        }}
      </ProFormDependency>
    </DrawerForm>
  )
}
