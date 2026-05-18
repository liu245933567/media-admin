import type {
  SubtitleGenerateBulkReq,
  SubtitleGenerateBulkRes,
  SubtitleGenerateDefaultsRes,
  SubtitleGenerateReq,
  SubtitleTranslateJobReq,
  TaskmillExecLogEntry,
  TaskmillJobSnapshot,
  TaskmillTaskHistoryRecord,
} from '@/types'
import { get, post } from './utils'

export const taskmillSnapshotQueryKey = ['taskmill-snapshot'] as const

export function fetchTaskmillSnapshot() {
  return get<TaskmillJobSnapshot>('/jobs/snapshot')
}

export interface TaskmillHistoryParams {
  limit?: number
  offset?: number
}

export function taskmillHistoryQueryKey(params: TaskmillHistoryParams) {
  return ['taskmill-history', params] as const
}

export function fetchTaskmillHistory(params: TaskmillHistoryParams = {}) {
  return get<TaskmillTaskHistoryRecord[], TaskmillHistoryParams>(
    '/jobs/history',
    {
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    },
  )
}

export interface TaskmillExecLogParams {
  limit?: number
}

export function taskmillExecLogQueryKey(params: TaskmillExecLogParams) {
  return ['taskmill-exec-log', params] as const
}

export function fetchTaskmillExecLog(params: TaskmillExecLogParams = {}) {
  return get<TaskmillExecLogEntry[], TaskmillExecLogParams>(
    '/jobs/exec-log',
    {
      limit: params.limit ?? 250,
    },
  )
}

export const subtitleGenerateDefaultsQueryKey = ['jobs', 'generate-defaults'] as const

export function fetchSubtitleGenerateDefaults() {
  return get<SubtitleGenerateDefaultsRes>('/jobs/generate-defaults')
}

export function enqueueSubtitleGenerate(req: SubtitleGenerateReq) {
  return post<unknown, SubtitleGenerateReq>('/jobs/generate', req)
}

export function enqueueSubtitleGenerateBulk(params: SubtitleGenerateBulkReq) {
  return post<SubtitleGenerateBulkRes, SubtitleGenerateBulkReq>(
    '/jobs/generate/bulk',
    params,
  )
}

export function enqueueSubtitleTranslate(job: SubtitleTranslateJobReq) {
  return post<unknown, SubtitleTranslateJobReq>('/jobs/translate', job)
}
