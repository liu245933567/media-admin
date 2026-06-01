import type {
  SubtitleGenerateConfig,
  SubtitleGenerateReq,
  SubtitleTranslateConfig,
  VadConfig,
} from '@/api'
import { Alert, Button, Checkbox, Drawer, Label } from '@heroui/react'
import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  generateBulkJobs,
  generateDefaultsJobs,
  generateJobs,
  getGenerateDefaultsJobsQueryKey,
  getListWhisperModelsSetupQueryKey,
  listWhisperModelsSetup,
} from '@/api'
import { useAppToast } from '@/components/app-toast'
import { RhfTextField } from '@/components/rhf-heroui-fields'
import { SubtitlePipelineFormGroups } from '@/components/subtitle-pipeline-form-groups'

export interface SubtitleTaskBulkSourceRow {
  video_path: string
  subtitle_names: string[]
}

export interface SubtitleTaskCreateDrawerFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
  /** 打开时预填视频路径（例如扫描页单条「字幕生成」） */
  initialVideoPath?: string
  /** 非空时为批量创建：共用表单中的识别/翻译等配置，路径来自视频列表 */
  bulkSourceRows?: SubtitleTaskBulkSourceRow[]
}

/** 表单字段：配置项 + 单条模式下的视频路径 */
type SubtitleGenerateFormValues = SubtitleGenerateConfig & {
  video_path?: string
}

const subtitleGenerateSchema = z.object({
  video_path: z.string().optional(),
  vad_config: z.any().optional(),
  whisper_engine_config: z.any().optional(),
  whisper_transcribe_config: z.any().optional(),
  translate_config: z.any().optional(),
})

function nullToUndefined<T>(value: T | null | undefined): T | undefined {
  return value ?? undefined
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
  const message = useAppToast()
  const isBulk = Boolean(props.bulkSourceRows?.length)

  const [skipDiskSubtitle, setSkipDiskSubtitle] = useState(true)
  const [inheritVad, setInheritVad] = useState(true)
  const [inheritWhisperEngine, setInheritWhisperEngine] = useState(true)
  const [inheritWhisperTranscribe, setInheritWhisperTranscribe] = useState(true)
  const [inheritTranslate, setInheritTranslate] = useState(true)
  const [enableTranslate, setEnableTranslate] = useState(true)

  const form = useForm<SubtitleGenerateFormValues>({
    defaultValues: {
      video_path: props.initialVideoPath?.trim() ?? '',
      vad_config: DEFAULT_VAD_CONFIG,
    },
  })

  const targetBulkPaths = useMemo(() => {
    const rows = props.bulkSourceRows ?? []
    if (!skipDiskSubtitle)
      return rows.map(r => r.video_path)
    return rows.filter(r => !(r.subtitle_names ?? []).length).map(r => r.video_path)
  }, [props.bulkSourceRows, skipDiskSubtitle])

  const defaultsQuery = useQuery({
    queryKey: getGenerateDefaultsJobsQueryKey(),
    queryFn: generateDefaultsJobs,
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
    queryKey: getListWhisperModelsSetupQueryKey(),
    queryFn: listWhisperModelsSetup,
  })
  const whisperModelFilenameOptions = useMemo(
    () =>
      (whisperModelsQuery.data?.items ?? []).map(m => ({
        label: `${m.label}（${m.filename}）${m.local_ready ? ' · 已就绪' : ''}`,
        value: m.filename,
      })),
    [whisperModelsQuery.data?.items],
  )

  const initialValues = useMemo((): SubtitleGenerateFormValues => {
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
      whisper_engine_config: nullToUndefined(c.whisper_engine_config),
      whisper_transcribe_config: nullToUndefined(c.whisper_transcribe_config),
      translate_config: nullToUndefined(c.translate_config),
    }
  }, [defaultsQuery.data, props.initialVideoPath])

  useEffect(() => {
    if (!props.open)
      return
    if (props.bulkSourceRows?.length)
      setSkipDiskSubtitle(true)
    setInheritVad(true)
    setInheritWhisperEngine(true)
    setInheritWhisperTranscribe(true)
    setInheritTranslate(true)
    setEnableTranslate(true)
    form.reset(initialValues)
  }, [form, initialValues, props.bulkSourceRows?.length, props.open])

  const buildConfig = useCallback(
    (values: SubtitleGenerateFormValues): SubtitleGenerateConfig => {
      const d = defaultsQuery.data?.config
      const { video_path: _vp, ...rest } = values

      const vad_config = inheritVad
        ? undefined
        : (rest.vad_config ?? d?.vad_config ?? DEFAULT_VAD_CONFIG)

      const whisper_engine_config = inheritWhisperEngine
        ? undefined
        : rest.whisper_engine_config ?? nullToUndefined(d?.whisper_engine_config)

      const whisper_transcribe_config = inheritWhisperTranscribe
        ? undefined
        : rest.whisper_transcribe_config ?? nullToUndefined(d?.whisper_transcribe_config)

      const translate_config = !enableTranslate
        ? undefined
        : inheritTranslate
          ? INHERIT_TRANSLATE_CONFIG
          : rest.translate_config ?? nullToUndefined(d?.translate_config)

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

  async function handleSubmit(values: SubtitleGenerateFormValues) {
    try {
      const parsed = subtitleGenerateSchema.safeParse(values)
      if (!parsed.success) {
        message.error(parsed.error.issues[0]?.message ?? '表单校验失败')
        return
      }
      if (isBulk) {
        if (!targetBulkPaths.length) {
          message.warning('没有需要生成的条目（可能都已存在字幕文件，或请取消勾选「跳过已存在字幕文件的条目」）')
          return
        }

        const res = await generateBulkJobs({
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
        props.onOpenChange(false)
        return
      }

      const video_path = (values.video_path ?? '').trim()
      if (!video_path) {
        message.error('请输入视频路径')
        return
      }
      const req: SubtitleGenerateReq = {
        video_path,
        config: buildConfig(values),
      }
      await generateJobs(req)
      message.success('任务已添加')
      props.onCreated?.()
      props.onOpenChange(false)
    }
    catch (e) {
      message.error((e as Error).message || '创建失败')
    }
  }

  return (
    <Drawer.Backdrop isOpen={props.open} onOpenChange={props.onOpenChange}>
      <Drawer.Content placement="right">
        <Drawer.Dialog className="w-full sm:w-[960px] sm:max-w-[960px]">
          <Drawer.CloseTrigger />
          <Drawer.Header>
            <Drawer.Heading>{isBulk ? '批量新增字幕任务' : '新增字幕任务'}</Drawer.Heading>
          </Drawer.Header>
          <form onSubmit={form.handleSubmit(handleSubmit)}>
            <Drawer.Body>
              <div className="flex flex-col gap-5">
                {isBulk && (
                  <div className="flex flex-col gap-3">
                    <Alert status="accent">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>
                          已选
                          <strong className="mx-1">{props.bulkSourceRows?.length ?? 0}</strong>
                          个视频，将创建
                          <strong className="mx-1">{targetBulkPaths.length}</strong>
                          个任务
                        </Alert.Title>
                      </Alert.Content>
                    </Alert>
                    <Checkbox
                      isSelected={skipDiskSubtitle}
                      onChange={setSkipDiskSubtitle}
                    >
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <Checkbox.Content>
                        <Label>跳过已存在字幕文件的条目</Label>
                      </Checkbox.Content>
                    </Checkbox>
                  </div>
                )}

                {!isBulk && (
                  <RhfTextField
                    control={form.control}
                    name="video_path"
                    label="视频路径"
                    placeholder="请输入视频路径"
                  />
                )}

                <SubtitlePipelineFormGroups
                  control={form.control}
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
                      isSelected={enableTranslate}
                      onChange={setEnableTranslate}
                    >
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                      <Checkbox.Content>
                        <Label>启用翻译</Label>
                      </Checkbox.Content>
                    </Checkbox>
                  )}
                />
              </div>
            </Drawer.Body>
            <Drawer.Footer>
              <Button variant="secondary" onPress={() => props.onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" isDisabled={defaultsQuery.isPending} isPending={form.formState.isSubmitting}>
                提交
              </Button>
            </Drawer.Footer>
          </form>
        </Drawer.Dialog>
      </Drawer.Content>
    </Drawer.Backdrop>
  )
}
