import type {
  FsListItem,
  MediaRootRow,
  SubtitleGenerateConfig,
  SubtitleTranslateConfig,
  VadConfig,
} from '@/api'
import { DrawerForm } from '@ant-design/pro-components'
import { useQuery } from '@tanstack/react-query'
import { Alert, App, AutoComplete, Checkbox, Form } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  generateDefaultsJobs,
  getGenerateDefaultsJobsQueryKey,
  getListRootsMediaLibraryQueryKey,
  getListWhisperModelsSetupQueryKey,
  listFs,
  listRootsMediaLibrary,
  listWhisperModelsSetup,
  scanGenerateJobs,
} from '@/api'
import { SubtitlePipelineFormGroups } from '@/components/subtitle-pipeline-form-groups'

type ScanGenerateSubtitleFormValues = SubtitleGenerateConfig & {
  folder_path?: string
}

const DEFAULT_VAD_CONFIG: VadConfig = {
  frame_ms: 30,
  mode: 2,
  padding_ms: 300,
  min_speech_ms: 200,
  max_segment_ms: 30_000,
}

const INHERIT_TRANSLATE_CONFIG: SubtitleTranslateConfig = {
  base_url: '',
  api_key: '',
  model: '',
  target_language: '',
  concurrency: 0,
  batch_size: 0,
  remove_source_srt: false,
}

export interface ScanGenerateSubtitleDrawerFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated?: () => void
}

function normalizePathForCompare(path: string): string {
  return path.trim().replace(/[\\/]+$/, '').toLocaleLowerCase()
}

function parentPathOf(path: string): string | undefined {
  const value = path.trim()
  const idx = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'))
  if (idx <= 0)
    return undefined
  return value.slice(0, idx)
}

function isMediaRootOrChild(folderPath: string, roots: MediaRootRow[]): boolean {
  const current = normalizePathForCompare(folderPath)
  return roots.some((root) => {
    const rootPath = normalizePathForCompare(root.path)
    if (!rootPath)
      return false
    if (current === rootPath)
      return true
    return current.startsWith(`${rootPath}\\`) || current.startsWith(`${rootPath}/`)
  })
}

function dirOptions(items: FsListItem[]) {
  return items
    .filter(item => item.is_dir)
    .map(item => ({
      value: item.full_path,
      label: item.full_path,
    }))
}

export function ScanGenerateSubtitleDrawerForm({
  open,
  onOpenChange,
  onCreated,
}: ScanGenerateSubtitleDrawerFormProps) {
  const { message } = App.useApp()
  const [folderOptions, setFolderOptions] = useState<{ label: string, value: string }[]>([])
  const [inheritVad, setInheritVad] = useState(true)
  const [inheritWhisperEngine, setInheritWhisperEngine] = useState(true)
  const [inheritWhisperTranscribe, setInheritWhisperTranscribe] = useState(true)
  const [inheritTranslate, setInheritTranslate] = useState(true)
  const [enableTranslate, setEnableTranslate] = useState(true)

  const rootsQuery = useQuery({
    queryKey: getListRootsMediaLibraryQueryKey(),
    queryFn: listRootsMediaLibrary,
    enabled: open,
  })

  const defaultsQuery = useQuery({
    queryKey: getGenerateDefaultsJobsQueryKey(),
    queryFn: generateDefaultsJobs,
    staleTime: 60 * 60 * 1000,
    enabled: open,
  })

  const whisperModelsQuery = useQuery({
    queryKey: getListWhisperModelsSetupQueryKey(),
    queryFn: listWhisperModelsSetup,
    enabled: open,
  })

  useEffect(() => {
    if (!open)
      return

    setFolderOptions((rootsQuery.data ?? []).map(root => ({
      label: `${root.name} - ${root.path}`,
      value: root.path,
    })))
    setInheritVad(true)
    setInheritWhisperEngine(true)
    setInheritWhisperTranscribe(true)
    setInheritTranslate(true)
    setEnableTranslate(true)
  }, [open, rootsQuery.data])

  useEffect(() => {
    if (defaultsQuery.isError) {
      message.error(
        defaultsQuery.error instanceof Error
          ? defaultsQuery.error.message
          : '加载默认配置失败',
      )
    }
  }, [defaultsQuery.error, defaultsQuery.isError, message])

  const whisperModelFilenameOptions = useMemo(
    () =>
      (whisperModelsQuery.data?.items ?? []).map(m => ({
        label: `${m.label}（${m.filename}）${m.local_ready ? ' · 已就绪' : ''}`,
        value: m.filename,
      })),
    [whisperModelsQuery.data?.items],
  )

  const initialValues = useMemo((): Partial<ScanGenerateSubtitleFormValues> => {
    const c = defaultsQuery.data?.config
    if (!c) {
      return {
        folder_path: '',
        vad_config: DEFAULT_VAD_CONFIG,
      }
    }
    return {
      ...c,
      folder_path: '',
      vad_config: c.vad_config ?? DEFAULT_VAD_CONFIG,
    }
  }, [defaultsQuery.data?.config])

  const buildConfig = useCallback(
    (values: ScanGenerateSubtitleFormValues): SubtitleGenerateConfig => {
      const d = defaultsQuery.data?.config
      const { folder_path: _folderPath, ...rest } = values

      return {
        vad_config: inheritVad
          ? undefined
          : (rest.vad_config ?? d?.vad_config ?? DEFAULT_VAD_CONFIG),
        whisper_engine_config: inheritWhisperEngine
          ? undefined
          : rest.whisper_engine_config ?? d?.whisper_engine_config,
        whisper_transcribe_config: inheritWhisperTranscribe
          ? undefined
          : rest.whisper_transcribe_config ?? d?.whisper_transcribe_config,
        translate_config: !enableTranslate
          ? undefined
          : inheritTranslate
            ? INHERIT_TRANSLATE_CONFIG
            : rest.translate_config ?? d?.translate_config,
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

  const loadFolderSuggestions = useCallback(async (value: string) => {
    const roots = rootsQuery.data ?? []
    if (!value.trim()) {
      setFolderOptions(roots.map(root => ({
        label: `${root.name} - ${root.path}`,
        value: root.path,
      })))
      return
    }

    const parentPath = parentPathOf(value)
    if (!parentPath)
      return

    try {
      const children = await listFs({ parent_path: parentPath })
      setFolderOptions(dirOptions(children))
    }
    catch {
      // 输入过程中补全失败不打断表单提交，提交时后端会给出严格校验错误。
    }
  }, [rootsQuery.data])

  const formKey = defaultsQuery.isSuccess
    ? String(defaultsQuery.dataUpdatedAt)
    : defaultsQuery.isError
      ? 'err'
      : 'pending'

  return (
    <DrawerForm<ScanGenerateSubtitleFormValues>
      key={formKey}
      title="扫描并生成字幕"
      open={open}
      onOpenChange={onOpenChange}
      grid
      drawerProps={{ destroyOnHidden: true }}
      initialValues={initialValues}
      submitter={{
        searchConfig: { submitText: '扫描并提交' },
        submitButtonProps: { disabled: defaultsQuery.isPending },
      }}
      onFinish={async (values) => {
        try {
          const nextFolderPath = (values.folder_path ?? '').trim()
          if (!nextFolderPath) {
            message.error('请输入文件夹路径')
            return false
          }
          if (!isMediaRootOrChild(nextFolderPath, rootsQuery.data ?? [])) {
            message.error('文件夹必须是已配置媒体文件夹或其子文件夹')
            return false
          }

          const res = await scanGenerateJobs({
            folder_path: nextFolderPath,
            config: buildConfig(values),
            skip_if_exists: true,
          })
          const failed = res.failed ?? []
          if (failed.length) {
            message.warning(`已扫描 ${res.scan.scanned} 个文件，发现 ${res.without_subtitles} 个无字幕视频，提交 ${res.submitted.length} 个，失败 ${failed.length} 个`)
            console.error('[scan subtitle generate] failed:', failed)
          }
          else {
            message.success(`已扫描 ${res.scan.scanned} 个文件，提交 ${res.submitted.length} 个字幕生成任务`)
          }
          onCreated?.()
          return true
        }
        catch (e) {
          message.error((e as Error).message || '创建失败')
          return false
        }
      }}
    >
      <Alert
        className="mb-4"
        type="info"
        showIcon
        message="将先扫描指定媒体文件夹并更新媒体库，再把无字幕视频批量加入字幕生成队列。"
      />
      <Form.Item
        name="folder_path"
        label="文件夹路径"
        rules={[
          { required: true, message: '请输入文件夹路径' },
          {
            validator: async (_, value) => {
              const next = String(value ?? '').trim()
              if (!next)
                throw new Error('请输入文件夹路径')
              if (!isMediaRootOrChild(next, rootsQuery.data ?? []))
                throw new Error('文件夹必须是已配置媒体文件夹或其子文件夹')
            },
          },
        ]}
      >
        <AutoComplete
          options={folderOptions}
          placeholder="输入或选择已配置媒体文件夹或其子文件夹"
          onSearch={(value) => {
            void loadFolderSuggestions(value)
          }}
          filterOption={(inputValue, option) =>
            String(option?.value ?? '').toLocaleLowerCase().includes(inputValue.toLocaleLowerCase())}
        />
      </Form.Item>

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
