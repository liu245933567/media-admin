import type { DownloadBody, DownloadResponse, FsListItem, FsTreeReq, SubtitleWebSearchReq, SubtitleWebSearchRes } from '@/types'
import { create } from 'axios'

const axiosIns = create({
  baseURL: '/api',
})

axiosIns.interceptors.response.use((res) => {
  if (res.status !== 200) {
    const message = res.data?.message ?? res.statusText ?? '出错了'
    throw new Error(message)
  }
  return res
})

async function post<Res = unknown, Req = unknown>(url: string, data: Req) {
  const res = await axiosIns.post<Res>(url, data)
  return res.data
}

/** 查询设备文件树 */
export function fetchFsList(params: FsTreeReq) {
  return post<FsListItem[], FsTreeReq>('/fs/list', params)
}

/** 查询网络字幕 */
export function searchSubtitles(params: SubtitleWebSearchReq) {
  return post<SubtitleWebSearchRes, SubtitleWebSearchReq>('/subtitle-web/search', params)
}

/** 下载字幕到后端磁盘（写入视频同目录） */
export function downloadSubtitleToDisk(params: DownloadBody) {
  return post<DownloadResponse, DownloadBody>('/subtitle-web/download', params)
}

/** 下载字幕二进制（浏览器直接保存） */
export async function downloadSubtitleBytes(params: DownloadBody) {
  const res = await axiosIns.post<ArrayBuffer>('/subtitle-web/download-bytes', params, {
    responseType: 'arraybuffer',
  })
  return res
}
