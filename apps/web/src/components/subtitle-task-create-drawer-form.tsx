import type { SubtitleGenerateConfig, VideoFolderScanItem } from '@/types/api'
import { DrawerForm, ProFormDependency, ProFormDigit, ProFormGroup, ProFormSelect, ProFormSwitch, ProFormText, ProFormTextArea } from '@ant-design/pro-components'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, Checkbox } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  enqueueSubtitleGenerate,
  enqueueSubtitleGenerateBulk,
  fetchSubtitleGenerateDefaults,
  fetchWhisperModels,
  subtitleGenerateDefaultsQueryKey,
  whisperModelsQueryKey,
} from '@/request'

export interface SubtitleTaskCreateDrawerFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
  /** 打开时预填视频路径（例如扫描页单条「字幕生成」） */
  initialVideoPath?: string
  /** 非空时为批量创建：共用表单中的识别/翻译等配置，路径来自扫描结果 */
  bulkSourceRows?: VideoFolderScanItem[]
}

export function SubtitleTaskCreateDrawerForm(props: SubtitleTaskCreateDrawerFormProps) {
  const { message } = App.useApp()
  const isBulk = Boolean(props.bulkSourceRows?.length)

  const [skipDiskSubtitle, setSkipDiskSubtitle] = useState(true)

  const targetBulkPaths = useMemo(() => {
    const rows = props.bulkSourceRows ?? []
    if (!skipDiskSubtitle)
      return rows.map(r => r.video_path)
    return rows.filter(r => !(r.subtitle_names ?? []).length).map(r => r.video_path)
  }, [props.bulkSourceRows, skipDiskSubtitle])

  const defaultsQuery = useQuery({
    queryKey: subtitleGenerateDefaultsQueryKey,
    queryFn: fetchSubtitleGenerateDefaults,
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
    const path = props.initialVideoPath?.trim() ?? ''
    if (!c)
      return { video_path: path }
    return {
      ...c,
      video_path: path,
    }
  }, [defaultsQuery.data, props.initialVideoPath])

  const formMountKey = defaultsQuery.isSuccess
    ? String(defaultsQuery.dataUpdatedAt)
    : defaultsQuery.isError
      ? 'err'
      : 'pending'

  const bulkSessionKey = props.bulkSourceRows?.length
    ? props.bulkSourceRows.map(r => r.video_path).join('\u0001')
    : ''

  const drawerFormKey = `${formMountKey}|${props.initialVideoPath ?? ''}|${bulkSessionKey}`

  const buildConfig = useCallback((values: SubtitleGenerateConfig): SubtitleGenerateConfig => {
    return {
      ...values,
      video_path: (values.video_path ?? '').trim(),
      translate_cfg: enableTranslate ? values.translate_cfg : undefined,
    }
  }, [enableTranslate])

  return (
    <DrawerForm<SubtitleGenerateConfig>
      key={drawerFormKey}
      title={isBulk ? '批量新增字幕任务' : '新增字幕任务'}
      open={props.open}
      onOpenChange={(open) => {
        if (open && props.bulkSourceRows?.length)
          setSkipDiskSubtitle(true)
        props.onOpenChange(open)
      }}
      grid
      drawerProps={{ destroyOnHidden: true }}
      initialValues={initialValues}
      submitter={{
        searchConfig: { submitText: '提交' },
        submitButtonProps: { disabled: defaultsQuery.isPending },
      }}
      onFinish={async (values) => {
        try {
          if (isBulk) {
            if (!targetBulkPaths.length) {
              message.warning('没有需要生成的条目（可能都已存在字幕文件，或请取消勾选「跳过已存在字幕文件的条目」）')
              return false
            }

            const template = buildConfig({ ...values, video_path: '' })
            const configs: SubtitleGenerateConfig[] = targetBulkPaths.map(vp => ({
              ...template,
              video_path: vp.trim(),
            }))

            const res = await enqueueSubtitleGenerateBulk({
              configs,
              skip_if_exists: true,
            })

            const ok = res.submitted?.length ?? 0
            const skipped = res.skipped?.length ?? 0
            const failed = res.failed ?? []

            if (failed.length === 0) {
              const parts = [
                `已添加 ${ok} 个任务`,
                skipped ? `跳过 ${skipped} 个（已在队列中）` : '',
              ].filter(Boolean)
              message.success(parts.join('，'))
            }
            else {
              message.warning(`已添加 ${ok} 个任务，跳过 ${skipped} 个，失败 ${failed.length} 个（打开控制台查看详情）`)
              console.error('[bulk subtitle generate] failed:', failed)
            }

            props.onCreated?.()
            return true
          }

          const config = buildConfig(values)
          await enqueueSubtitleGenerate(config)
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
      {isBulk && (
        <div className="mb-4 flex flex-col gap-2">
          <Alert
            type="info"
            showIcon
            title={(
              <span>
                已选
                <strong className="mx-1">{props.bulkSourceRows?.length ?? 0}</strong>
                个视频，将创建
                <strong className="mx-1">{targetBulkPaths.length}</strong>
                个任务
              </span>
            )}
          />
          <Checkbox
            checked={skipDiskSubtitle}
            onChange={e => setSkipDiskSubtitle(e.target.checked)}
          >
            跳过已存在字幕文件的条目
          </Checkbox>
        </div>
      )}

      {!isBulk && (
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
      )}

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
