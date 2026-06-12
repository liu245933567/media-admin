import type { ReactNode } from 'react'
import type { Control, FieldValues } from 'react-hook-form'
import { Label, Switch } from '@heroui/react'
import {
  RhfNumberField,
  RhfSelectField,
  RhfSwitchField,
  RhfTextAreaField,
  RhfTextField,
} from './rhf-heroui-fields'

export interface WhisperModelOption {
  label: string
  value: string
}

export interface SubtitlePipelineFormGroupsProps<
  TFieldValues extends FieldValues = FieldValues,
> {
  control: Control<TFieldValues>
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
    return <h3 className="m-0 text-base font-semibold">{props.title}</h3>
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h3 className="m-0 text-base font-semibold">{props.title}</h3>
      <Switch isSelected={props.inherit} onChange={props.onInheritChange}>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        <Switch.Content>
          <Label className="text-xs text-muted">继承全局设置</Label>
        </Switch.Content>
      </Switch>
    </div>
  )
}

export function SubtitlePipelineFormGroups<TFieldValues extends FieldValues>(
  props: SubtitlePipelineFormGroupsProps<TFieldValues>,
) {
  const v = props.variant ?? 'task'
  const apiKeyPlaceholder
    = v === 'setting'
      ? '留空则保存时不覆盖已存密钥'
      : '留空则使用服务端 TRANSLATE_OPENAI_API_KEY'
  const apiKeyExtra
    = v === 'setting'
      ? '设置页保存时若留空，将保留数据库中已保存的 API Key。'
      : '仅在任务中填写；不会回显已保存的密钥，编辑任务时请按需重新填写。'

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <GroupTitleWithInherit
          title="VAD 配置"
          inherit={props.inheritVad}
          onInheritChange={props.onInheritVadChange}
        />
        <div className="grid gap-4 md:grid-cols-3">
          <RhfNumberField
            control={props.control}
            name={'vad_config.frame_ms' as never}
            variant="secondary"
            label="帧长(ms)"
            minValue={10}
            maxValue={30}
            disabled={props.disabledVad}
          />
          <RhfNumberField
            control={props.control}
            name={'vad_config.mode' as never}
            variant="secondary"
            label="模式(0-3)"
            minValue={0}
            maxValue={3}
            disabled={props.disabledVad}
          />
          <RhfNumberField
            control={props.control}
            name={'vad_config.padding_ms' as never}
            variant="secondary"
            label="Padding(ms)"
            minValue={0}
            disabled={props.disabledVad}
          />
          <RhfNumberField
            control={props.control}
            name={'vad_config.min_speech_ms' as never}
            variant="secondary"
            label="最短语音段(ms)"
            minValue={0}
            disabled={props.disabledVad}
          />
          <RhfNumberField
            control={props.control}
            name={'vad_config.max_segment_ms' as never}
            variant="secondary"
            label="单段最大长度(ms)"
            minValue={0}
            disabled={props.disabledVad}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <GroupTitleWithInherit
          title="Whisper 引擎配置"
          inherit={props.inheritWhisperEngine}
          onInheritChange={props.onInheritWhisperEngineChange}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <RhfSelectField
            control={props.control}
            name={'whisper_engine_config.model_filename' as never}
            label="模型文件"
            placeholder="请选择模型文件"
            loading={props.whisperModelsLoading}
            options={props.whisperModelFilenameOptions}
            disabled={props.disabledWhisperEngine}
          />
          <div className="flex flex-col justify-end gap-3 pb-1">
            <RhfSwitchField
              control={props.control}
              name={'whisper_engine_config.use_gpu' as never}
              label="使用 GPU"
              disabled={props.disabledWhisperEngine}
            />
            <RhfSwitchField
              control={props.control}
              name={'whisper_engine_config.flash_attn' as never}
              label="启用 Flash Attention"
              disabled={props.disabledWhisperEngine}
            />
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <GroupTitleWithInherit
          title="Whisper 识别参数"
          inherit={props.inheritWhisperTranscribe}
          onInheritChange={props.onInheritWhisperTranscribeChange}
        />
        <div className="grid gap-4 md:grid-cols-3">
          <RhfTextField
            control={props.control}
            name={'whisper_transcribe_config.language' as never}
            label="语言代码"
            placeholder="留空表示 None；可填 auto / zh / en ..."
            disabled={props.disabledWhisperTranscribe}
          />
          <RhfNumberField
            control={props.control}
            name={'whisper_transcribe_config.beam_size' as never}
            label="beam_size"
            minValue={1}
            disabled={props.disabledWhisperTranscribe}
            variant="secondary"
          />
          <RhfNumberField
            control={props.control}
            name={'whisper_transcribe_config.greedy_best_of' as never}
            label="greedy_best_of"
            minValue={1}
            disabled={props.disabledWhisperTranscribe}
            variant="secondary"
          />
          <RhfNumberField
            control={props.control}
            name={'whisper_transcribe_config.n_threads' as never}
            label="CPU 线程数"
            minValue={0}
            disabled={props.disabledWhisperTranscribe}
            variant="secondary"
          />
          <RhfSwitchField
            control={props.control}
            name={'whisper_transcribe_config.auto_gain' as never}
            label="自动增益"
            disabled={props.disabledWhisperTranscribe}
          />
          <RhfSwitchField
            control={props.control}
            name={'whisper_transcribe_config.anti_hallucination' as never}
            label="抗幻觉参数组合"
            disabled={props.disabledWhisperTranscribe}
          />
        </div>
        <RhfTextAreaField
          control={props.control}
          name={'whisper_transcribe_config.initial_prompt' as never}
          label="初始 Prompt"
          placeholder="可选：专有名词、人名、风格示例等"
          disabled={props.disabledWhisperTranscribe}
          rows={3}
        />
      </section>

      {props.translateToggleSlot !== undefined
        && props.translateToggleSlot !== null
        ? (
            <div>{props.translateToggleSlot}</div>
          )
        : null}

      {props.showTranslateGroup
        ? (
            <section className="flex flex-col gap-4">
              <GroupTitleWithInherit
                title="翻译设置"
                inherit={props.inheritTranslate}
                onInheritChange={props.onInheritTranslateChange}
              />
              <div className="grid gap-4 md:grid-cols-2">
                <RhfTextField
                  control={props.control}
                  name={'translate_config.base_url' as never}
                  label="API Base URL"
                  placeholder="留空则使用服务端 TRANSLATE_OPENAI_BASE"
                  description="OpenAI 兼容接口根地址，默认与硅基流动一致时可保留表单默认值。"
                  disabled={props.disabledTranslate}
                />
                <RhfTextField
                  control={props.control}
                  name={'translate_config.api_key' as never}
                  label="API Key"
                  placeholder={apiKeyPlaceholder}
                  type="password"
                  description={apiKeyExtra}
                  disabled={props.disabledTranslate}
                />
                <RhfTextField
                  control={props.control}
                  name={'translate_config.target_language' as never}
                  label="目标语言"
                  placeholder="例如：Chinese / English / Japanese"
                  disabled={props.disabledTranslate}
                />
                <RhfTextField
                  control={props.control}
                  name={'translate_config.model' as never}
                  label="翻译模型"
                  placeholder="例如：tencent/Hunyuan-MT-7B"
                  disabled={props.disabledTranslate}
                />
                <RhfNumberField
                  control={props.control}
                  name={'translate_config.concurrency' as never}
                  label="并发数"
                  minValue={1}
                  disabled={props.disabledTranslate}
                  variant="secondary"
                />
                <RhfNumberField
                  control={props.control}
                  name={'translate_config.batch_size' as never}
                  label="批大小"
                  minValue={1}
                  disabled={props.disabledTranslate}
                  variant="secondary"
                />
                <RhfSwitchField
                  control={props.control}
                  name={'translate_config.remove_source_srt' as never}
                  label="翻译完成后删除原文 SRT"
                  disabled={props.disabledTranslate}
                />
              </div>
            </section>
          )
        : null}
    </div>
  )
}
