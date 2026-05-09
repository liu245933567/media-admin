import type {
  CreateJobBody,
  CreateJobResponse,
  DownloadBody,
  DownloadResponse,
  FsListItem,
  FsListReq,
  JobResponse,
  QueueStateResponse,
  SubtitleWebSearchReq,
  SubtitleWebSearchRes,
} from '@/types'
import { get, post } from './utils'

/** 查询设备文件树 */
export function fetchFsList(params: FsListReq) {
  return post<FsListItem[], FsListReq>('/fs/list', params)
}

/** 查询网络字幕 */
export function searchSubtitles(params: SubtitleWebSearchReq) {
  return post<SubtitleWebSearchRes, SubtitleWebSearchReq>('/subtitle-web/search', params)
}

/** 下载字幕到后端磁盘（写入视频同目录） */
export function downloadSubtitleToDisk(params: DownloadBody) {
  return post<DownloadResponse, DownloadBody>('/subtitle-web/download', params)
}

export interface ListSubtitleJobsParams {
  status?: string
  limit?: number
}

/** 创建本地字幕生成任务 */
export function createSubtitleJob(params: CreateJobBody) {
  return post<CreateJobResponse, CreateJobBody>('/subtitle-local/jobs', params)
}

/** 查询字幕生成任务列表 */
export function fetchSubtitleJobs(params?: ListSubtitleJobsParams) {
  return get<JobResponse[], ListSubtitleJobsParams>('/subtitle-local/jobs', params)
}

/** 查询单个字幕生成任务 */
export function fetchSubtitleJob(id: string) {
  return get<JobResponse>(`/subtitle-local/jobs/${id}`)
}

/** 暂停队列：当前任务执行完后停止调度下一个 */
export function pauseSubtitleQueue() {
  return post<QueueStateResponse, Record<string, never>>('/subtitle-local/pause', {})
}

/** 恢复队列 */
export function resumeSubtitleQueue() {
  return post<QueueStateResponse, Record<string, never>>('/subtitle-local/resume', {})
}

/** 查询队列状态 */
export function fetchSubtitleQueueState() {
  return get<QueueStateResponse>('/subtitle-local/queue-state')
}

export * from './stash'
