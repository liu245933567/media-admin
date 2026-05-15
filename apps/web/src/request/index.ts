import type {
  DownloadJobStartRes,
  FfmpegDownloadStartReq,
  FfmpegSetupStatusRes,
  FsListItem,
  FsListReq,
  FsReadTextReq,
  FsReadTextRes,
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

/** 递归扫描文件夹下视频文件（同 stem 字幕列表） */
export function scanVideoFolder(params: VideoFolderScanReq) {
  return post<VideoFolderScanRes, VideoFolderScanReq>('/video-folder/scan', params)
}

export * from './job'
export * from './stash'
export * from './subtitle'

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
