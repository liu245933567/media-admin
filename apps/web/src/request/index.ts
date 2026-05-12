import type {
  DownloadBody,
  DownloadJobStartRes,
  DownloadResponse,
  FfmpegDownloadStartReq,
  FfmpegSetupStatusRes,
  FsDeleteReq,
  FsDeleteRes,
  FsListItem,
  FsListReq,
  FsReadTextReq,
  FsReadTextRes,
  SubtitleTaskBulkCreateReq,
  SubtitleTaskBulkCreateRes,
  SubtitleTaskCreateReq,
  SubtitleTaskDeleteReq,
  SubtitleTaskDeleteRes,
  SubtitleTaskGenerateDefaultsRes,
  SubtitleTaskItem,
  SubtitleTaskListReq,
  SubtitleTaskListRes,
  SubtitleTaskQueuePauseReq,
  SubtitleTaskQueuePauseRes,
  SubtitleTaskQueueResumeReq,
  SubtitleTaskQueueResumeRes,
  SubtitleTaskQueueStatusReq,
  SubtitleTaskQueueStatusRes,
  SubtitleTaskRetryReq,
  SubtitleTaskRetryRes,
  SubtitleTranslateTaskCreateReq,
  SubtitleTranslateTaskDeleteReq,
  SubtitleTranslateTaskDeleteRes,
  SubtitleTranslateTaskItem,
  SubtitleTranslateTaskListReq,
  SubtitleTranslateTaskListRes,
  SubtitleTranslateTaskQueuePauseReq,
  SubtitleTranslateTaskQueuePauseRes,
  SubtitleTranslateTaskQueueResumeReq,
  SubtitleTranslateTaskQueueResumeRes,
  SubtitleTranslateTaskQueueStatusReq,
  SubtitleTranslateTaskQueueStatusRes,
  SubtitleTranslateTaskRetryReq,
  SubtitleTranslateTaskRetryRes,
  SubtitleWebSearchReq,
  SubtitleWebSearchRes,
  VideoFolderScanReq,
  VideoFolderScanRes,
  WhisperDownloadStartReq,
  WhisperModelsListRes,
} from '@/types'
import { get, post } from './utils'

/** 查询设备文件树 */
export function fetchFsList(params: FsListReq) {
  return post<FsListItem[], FsListReq>('/fs/list', params)
}

/** 读取文本文件（用于预览字幕内容） */
export function fetchFsReadText(params: FsReadTextReq) {
  return post<FsReadTextRes, FsReadTextReq>('/fs/read-text', params)
}

/** 删除磁盘上的字幕文件（扩展名与目录扫描一致） */
export function fetchFsDeleteSubtitle(params: FsDeleteReq) {
  return post<FsDeleteRes, FsDeleteReq>('/fs/delete-subtitle', params)
}

/** 递归扫描文件夹下视频文件（同 stem 字幕列表） */
export function scanVideoFolder(params: VideoFolderScanReq) {
  return post<VideoFolderScanRes, VideoFolderScanReq>('/video-folder/scan', params)
}

/** 查询网络字幕 */
export function searchSubtitles(params: SubtitleWebSearchReq) {
  return post<SubtitleWebSearchRes, SubtitleWebSearchReq>(
    '/subtitle-web/search',
    params,
  )
}

/** 下载字幕到后端磁盘（写入视频同目录） */
export function downloadSubtitleToDisk(params: DownloadBody) {
  return post<DownloadResponse, DownloadBody>('/subtitle-web/download', params)
}

/** React Query 与「字幕任务默认配置」接口共用的 queryKey */
export const subtitleTaskGenerateDefaultsQueryKey = ['subtitle-task', 'generate-defaults'] as const

export const subtitleTaskQueueStatusQueryKey = ['subtitle-task-queue-status'] as const

/** 获取新建字幕任务的默认配置（与后端 `SubtitleGenerateConfig::default()` 一致） */
export function fetchSubtitleTaskGenerateDefaults() {
  return get<SubtitleTaskGenerateDefaultsRes>('/subtitle-task/generate-defaults')
}

/** 向 subtitle_task 表插入一条记录 */
export function createSubtitleTask(params: SubtitleTaskCreateReq) {
  return post<SubtitleTaskItem, SubtitleTaskCreateReq>(
    '/subtitle-task/tasks',
    params,
  )
}

/** 批量向 subtitle_task 表插入记录（服务端可做去重/跳过） */
export function createSubtitleTasksBulk(params: SubtitleTaskBulkCreateReq) {
  return post<SubtitleTaskBulkCreateRes, SubtitleTaskBulkCreateReq>(
    '/subtitle-task/tasks/bulk',
    params,
  )
}

/** 分页查询 subtitle_task 表 */
export function fetchSubtitleTaskList(params: SubtitleTaskListReq) {
  return post<SubtitleTaskListRes, SubtitleTaskListReq>(
    '/subtitle-task/tasks/list',
    params,
  )
}

/** 删除字幕任务（含关联记录） */
export function deleteSubtitleTask(params: SubtitleTaskDeleteReq) {
  return post<SubtitleTaskDeleteRes, SubtitleTaskDeleteReq>(
    '/subtitle-task/tasks/delete',
    params,
  )
}

/** 失败任务重置为待处理并重新入队 */
export function retrySubtitleTask(params: SubtitleTaskRetryReq) {
  return post<SubtitleTaskRetryRes, SubtitleTaskRetryReq>(
    '/subtitle-task/tasks/retry',
    params,
  )
}

/** React Query 与「字幕翻译任务队列状态」共用的 queryKey */
export const subtitleTranslateTaskQueueStatusQueryKey = ['subtitle-translate-task-queue-status'] as const

/** 分页查询 subtitle_translate_task */
export function fetchSubtitleTranslateTaskList(params: SubtitleTranslateTaskListReq) {
  return post<SubtitleTranslateTaskListRes, SubtitleTranslateTaskListReq>(
    '/subtitle-translate-task/tasks/list',
    params,
  )
}

export function createSubtitleTranslateTask(params: SubtitleTranslateTaskCreateReq) {
  return post<SubtitleTranslateTaskItem, SubtitleTranslateTaskCreateReq>(
    '/subtitle-translate-task/tasks',
    params,
  )
}

export function deleteSubtitleTranslateTask(params: SubtitleTranslateTaskDeleteReq) {
  return post<SubtitleTranslateTaskDeleteRes, SubtitleTranslateTaskDeleteReq>(
    '/subtitle-translate-task/tasks/delete',
    params,
  )
}

export function retrySubtitleTranslateTask(params: SubtitleTranslateTaskRetryReq) {
  return post<SubtitleTranslateTaskRetryRes, SubtitleTranslateTaskRetryReq>(
    '/subtitle-translate-task/tasks/retry',
    params,
  )
}

export function pauseSubtitleTranslateTaskQueue(params: SubtitleTranslateTaskQueuePauseReq = {}) {
  return post<SubtitleTranslateTaskQueuePauseRes, SubtitleTranslateTaskQueuePauseReq>(
    '/subtitle-translate-task/queue/pause',
    params,
  )
}

export function resumeSubtitleTranslateTaskQueue(params: SubtitleTranslateTaskQueueResumeReq = {}) {
  return post<SubtitleTranslateTaskQueueResumeRes, SubtitleTranslateTaskQueueResumeReq>(
    '/subtitle-translate-task/queue/resume',
    params,
  )
}

export function fetchSubtitleTranslateTaskQueueStatus(params: SubtitleTranslateTaskQueueStatusReq = {}) {
  return post<SubtitleTranslateTaskQueueStatusRes, SubtitleTranslateTaskQueueStatusReq>(
    '/subtitle-translate-task/queue/status',
    params,
  )
}

/** 暂停字幕任务队列（不再 claim 新任务；当前任务跑完后进入已暂停） */
export function pauseSubtitleTaskQueue(params: SubtitleTaskQueuePauseReq = {}) {
  return post<SubtitleTaskQueuePauseRes, SubtitleTaskQueuePauseReq>(
    '/subtitle-task/queue/pause',
    params,
  )
}

/** 开始/恢复字幕任务队列（允许 worker claim 新任务） */
export function resumeSubtitleTaskQueue(params: SubtitleTaskQueueResumeReq = {}) {
  return post<SubtitleTaskQueueResumeRes, SubtitleTaskQueueResumeReq>(
    '/subtitle-task/queue/resume',
    params,
  )
}

/** 获取字幕任务队列状态 */
export function fetchSubtitleTaskQueueStatus(params: SubtitleTaskQueueStatusReq = {}) {
  return post<SubtitleTaskQueueStatusRes, SubtitleTaskQueueStatusReq>(
    '/subtitle-task/queue/status',
    params,
  )
}

/** React Query 等与 Whisper 模型列表接口共用的 queryKey */
export const whisperModelsQueryKey = ['setup', 'whisper-models'] as const

/** 可下载的 Whisper 模型目录（含服务端检测的 local_ready） */
export function fetchWhisperModels() {
  return get<WhisperModelsListRes>('/setup/whisper/models')
}

/** 开始下载 Whisper 模型，返回 job_id 用于 SSE 订阅进度 */
export function startWhisperDownload(params: WhisperDownloadStartReq) {
  return post<DownloadJobStartRes, WhisperDownloadStartReq>(
    '/setup/whisper/download',
    params,
  )
}

/** React Query 与 FFmpeg 安装状态接口共用的 queryKey */
export const ffmpegSetupStatusQueryKey = ['setup', 'ffmpeg-status'] as const

/** 查询配置的 FFMPEG_DIR 下是否已有 ffmpeg */
export function fetchFfmpegSetupStatus() {
  return get<FfmpegSetupStatusRes>('/setup/ffmpeg/status')
}

/** 开始下载当前平台的 FFmpeg，返回 job_id */
export function startFfmpegDownload(params: FfmpegDownloadStartReq = {}) {
  return post<DownloadJobStartRes, FfmpegDownloadStartReq>(
    '/setup/ffmpeg/download',
    params,
  )
}

export * from './stash'
