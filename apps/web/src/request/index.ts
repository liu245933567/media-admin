import type {
  DownloadBody,
  DownloadResponse,
  FsListItem,
  FsListReq,
  FsReadTextReq,
  FsReadTextRes,
  SubtitleTaskBulkCreateReq,
  SubtitleTaskBulkCreateRes,
  SubtitleTaskCreateReq,
  SubtitleTaskCreateRes,
  SubtitleTaskDeleteReq,
  SubtitleTaskDeleteRes,
  SubtitleTaskListReq,
  SubtitleTaskListRes,
  SubtitleTaskQueuePauseReq,
  SubtitleTaskQueuePauseRes,
  SubtitleTaskQueueResumeReq,
  SubtitleTaskQueueResumeRes,
  SubtitleTaskQueueStatusReq,
  SubtitleTaskQueueStatusRes,
  SubtitleWebSearchReq,
  SubtitleWebSearchRes,
  VideoFolderScanReq,
  VideoFolderScanRes,
} from '@/types'
import { post } from './utils'

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

/** 向 subtitle_task 表插入一条记录 */
export function createSubtitleTask(params: SubtitleTaskCreateReq) {
  return post<SubtitleTaskCreateRes, SubtitleTaskCreateReq>(
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

/** 暂停字幕任务队列（取消当前 RUNNING 并重新入队；worker 停止 claim 新任务） */
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

export * from './stash'
