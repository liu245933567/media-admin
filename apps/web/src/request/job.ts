import type {
  ScanGenerateSubtitleReq,
  ScanGenerateSubtitleRes,
  SubtitleGenerateBulkReq,
  SubtitleGenerateBulkRes,
  SubtitleGenerateDefaultsRes,
  SubtitleGenerateReq,
  SubtitleTranslateJobReq,
  TaskmillExecLogEntry,
  TaskmillJobSnapshot,
  TaskmillTaskHistoryRecord,
  TaskmillTaskRecord,
} from '@/types'
import { del, get, post } from './utils'

export interface TaskmillControlOk {
  ok: boolean
}

export interface TaskmillCancelRes {
  cancelled: boolean
}

export interface TaskmillDeleteHistoryRes {
  deleted: boolean
}

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

export function scanAndEnqueueSubtitleGenerate(params: ScanGenerateSubtitleReq) {
  return post<ScanGenerateSubtitleRes, ScanGenerateSubtitleReq>(
    '/jobs/scan-generate',
    params,
  )
}

export function enqueueSubtitleTranslate(job: SubtitleTranslateJobReq) {
  return post<unknown, SubtitleTranslateJobReq>('/jobs/translate', job)
}

export function taskmillActiveQueryKey(params: TaskmillActiveParams = {}) {
  return ['taskmill-active', params] as const
}

export interface TaskmillActiveParams {
  limit?: number
}

export function fetchTaskmillActiveTasks(params: TaskmillActiveParams = {}) {
  return get<TaskmillTaskRecord[], TaskmillActiveParams>('/jobs/active', {
    limit: params.limit ?? 200,
  })
}

export function pauseTaskmillScheduler() {
  return post<TaskmillControlOk>('/jobs/scheduler/pause')
}

export function resumeTaskmillScheduler() {
  return post<TaskmillControlOk>('/jobs/scheduler/resume')
}

export function cancelTaskmillTask(taskId: number) {
  return post<TaskmillCancelRes>(`/jobs/tasks/${taskId}/cancel`)
}

export function pauseTaskmillTask(taskId: number) {
  return post<TaskmillControlOk>(`/jobs/tasks/${taskId}/pause`)
}

export function resumeTaskmillTask(taskId: number) {
  return post<TaskmillControlOk>(`/jobs/tasks/${taskId}/resume`)
}

export function deleteTaskmillHistory(historyId: number) {
  return del<TaskmillDeleteHistoryRes>(`/jobs/history/${historyId}`)
}
