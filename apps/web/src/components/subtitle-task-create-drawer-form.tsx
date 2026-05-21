import type {
  SubtitleGenerateConfig,
  SubtitleGenerateReq,
  SubtitleTranslateConfig,
  VadConfig,
  VideoFolderScanItem,
} from '@/types/api'
import { DrawerForm, ProFormText } from '@ant-design/pro-components'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, Checkbox } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SubtitlePipelineFormGroups } from '@/components/subtitle-pipeline-form-groups'
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

/** 表单字段：配置项 + 单条模式下的视频路径 */
type SubtitleGenerateFormValues = SubtitleGenerateConfig & {
  video_path?: string
}

const DEFAULT_VAD_CONFIG: VadConfig = {
  frame_ms: 30,
  mode: 2,
  padding_ms: 300,
  min_speech_ms: 200,
  max_segment_ms: 30_000,
}

/** 继承全局翻译：空字段由服务端 merge；`translate_config` 缺省/`None` 表示本任务不翻译 */
const INHERIT_TRANSLATE_CONFIG: SubtitleTranslateConfig = {
  base_url: '',
  api_key: '',
  model: '',
  target_language: '',
  concurrency: 0,
  batch_size: 0,
  remove_source_srt: false,
}

export function SubtitleTaskCreateDrawerForm(props: SubtitleTaskCreateDrawerFormProps) {
  const { message } = App.useApp()
  const isBulk = Boolean(props.bulkSourceRows?.length)

  const [skipDiskSubtitle, setSkipDiskSubtitle] = useState(true)
  const [inheritVad, setInheritVad] = useState(true)
  const [inheritWhisperEngine, setInheritWhisperEngine] = useState(true)
  const [inheritWhisperTranscribe, setInheritWhisperTranscribe] = useState(true)
  const [inheritTranslate, setInheritTranslate] = useState(true)

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

  const initialValues = useMemo((): Partial<SubtitleGenerateFormValues> => {
    const c = defaultsQuery.data?.config
    const path = props.initialVideoPath?.trim() ?? ''
    if (!c) {
      return {
        video_path: path,
        vad_config: DEFAULT_VAD_CONFIG,
      }
    }
    return {
      ...c,
      video_path: path,
      vad_config: c.vad_config ?? DEFAULT_VAD_CONFIG,
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

  const buildConfig = useCallback(
    (values: SubtitleGenerateFormValues): SubtitleGenerateConfig => {
      const d = defaultsQuery.data?.config
      const { video_path: _vp, ...rest } = values

      const vad_config = inheritVad
        ? undefined
        : (rest.vad_config ?? d?.vad_config ?? DEFAULT_VAD_CONFIG)

      const whisper_engine_config = inheritWhisperEngine
        ? undefined
        : rest.whisper_engine_config ?? d?.whisper_engine_config

      const whisper_transcribe_config = inheritWhisperTranscribe
        ? undefined
        : rest.whisper_transcribe_config ?? d?.whisper_transcribe_config

      const translate_config = !enableTranslate
        ? undefined
        : inheritTranslate
          ? INHERIT_TRANSLATE_CONFIG
          : rest.translate_config ?? d?.translate_config

      return {
        vad_config,
        whisper_engine_config,
        whisper_transcribe_config,
        translate_config,
      }
    },
    [
      defaultsQuery.data?.config,
      enableTranslate,
      inheritTranslate,
      inheritVad,
      inheritWhisperEngine,
      inheritWhisperTranscribe,
    ],
  )

  return (
    <DrawerForm<SubtitleGenerateFormValues>
      key={drawerFormKey}
      title={isBulk ? '批量新增字幕任务' : '新增字幕任务'}
      open={props.open}
      onOpenChange={(open) => {
        if (open && props.bulkSourceRows?.length)
          setSkipDiskSubtitle(true)
        if (open) {
          setInheritVad(true)
          setInheritWhisperEngine(true)
          setInheritWhisperTranscribe(true)
          setInheritTranslate(true)
        }
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

            const res = await enqueueSubtitleGenerateBulk({
              video_paths: targetBulkPaths.map(vp => vp.trim()),
              config: buildConfig(values),
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

          const video_path = (values.video_path ?? '').trim()
          if (!video_path) {
            message.error('请输入视频路径')
            return false
          }
          const req: SubtitleGenerateReq = {
            video_path,
            config: buildConfig(values),
          }
          await enqueueSubtitleGenerate(req)
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

      <SubtitlePipelineFormGroups
        whisperModelFilenameOptions={whisperModelFilenameOptions}
        whisperModelsLoading={whisperModelsQuery.isPending}
        showTranslateGroup={enableTranslate}
        disabledVad={inheritVad}
        disabledWhisperEngine={inheritWhisperEngine}
        disabledWhisperTranscribe={inheritWhisperTranscribe}
        disabledTranslate={inheritTranslate}
        inheritVad={inheritVad}
        onInheritVadChange={setInheritVad}
        inheritWhisperEngine={inheritWhisperEngine}
        onInheritWhisperEngineChange={setInheritWhisperEngine}
        inheritWhisperTranscribe={inheritWhisperTranscribe}
        onInheritWhisperTranscribeChange={setInheritWhisperTranscribe}
        inheritTranslate={inheritTranslate}
        onInheritTranslateChange={setInheritTranslate}
        variant="task"
        translateToggleSlot={(
          <Checkbox
            checked={enableTranslate}
            onChange={e => setEnableTranslate(e.target.checked)}
          >
            启用翻译
          </Checkbox>
        )}
      />

    </DrawerForm>
  )
}
