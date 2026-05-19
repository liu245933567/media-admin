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
  VideoPlaybackProbeRes,
  VideoTranscodeStatusRes,
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

/** 本地视频流 URL（供 video.js / `<video>` 使用，支持 Range） */
export function buildLocalVideoSrc(path: string): string {
  return `/api/fs/video?path=${encodeURIComponent(path)}`
}

/** 转码后的 MP4 流 URL（须先完成转码） */
export function buildTranscodedVideoSrc(path: string): string {
  return `/api/fs/video/transcoded?path=${encodeURIComponent(path)}`
}

/** 探测视频是否适合浏览器直链播放 */
export function fetchVideoPlaybackProbe(params: { path: string }) {
  return get<VideoPlaybackProbeRes>('/fs/video/probe', params)
}

/** 查询转码进度 */
export function fetchVideoTranscodeStatus(params: { path: string }) {
  return get<VideoTranscodeStatusRes>('/fs/video/transcode/status', params)
}

/** 启动服务端转码（幂等） */
export function startVideoTranscode(params: { path: string }) {
  const q = encodeURIComponent(params.path)
  return post<VideoTranscodeStatusRes>(`/fs/video/transcode/start?path=${q}`)
}

/** 递归扫描文件夹下视频文件（同 stem 字幕列表） */
export function scanVideoFolder(params: VideoFolderScanReq) {
  return post<VideoFolderScanRes, VideoFolderScanReq>('/video-folder/scan', params)
}

export * from './job'
export * from './settings'
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
