import type { DownloadBody, DownloadResponse, FsDeleteReq, FsDeleteRes, SubtitleWebSearchReq, SubtitleWebSearchRes } from '@/types'
import { post } from './utils'

/** 查询网络字幕 */
export function searchSubtitlesApi(params: SubtitleWebSearchReq) {
  return post<SubtitleWebSearchRes, SubtitleWebSearchReq>(
    '/subtitle-web/search',
    params,
  )
}

/** 下载字幕到后端磁盘（写入视频同目录） */
export function downloadSubtitleToDiskApi(params: DownloadBody) {
  return post<DownloadResponse, DownloadBody>('/subtitle-web/download', params)
}

/** 删除磁盘上的字幕文件（扩展名与目录扫描一致） */
export function fetchFsDeleteSubtitleApi(params: FsDeleteReq) {
  return post<FsDeleteRes, FsDeleteReq>('/fs/delete-subtitle', params)
}
