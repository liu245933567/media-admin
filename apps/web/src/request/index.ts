import type {
  DownloadBody,
  DownloadResponse,
  FsListItem,
  FsListReq,
  SubtitleTaskCreateReq,
  SubtitleTaskCreateRes,
  SubtitleTaskDeleteReq,
  SubtitleTaskDeleteRes,
  SubtitleTaskListReq,
  SubtitleTaskListRes,
  SubtitleWebSearchReq,
  SubtitleWebSearchRes,
} from '@/types'
import { post } from './utils'

/** 查询设备文件树 */
export function fetchFsList(params: FsListReq) {
  return post<FsListItem[], FsListReq>('/fs/list', params)
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

export * from './stash'
