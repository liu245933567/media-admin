import type {
  TaskmillDemoExecLogEntry,
  TaskmillJobDemoSnapshot,
  TaskmillTaskHistoryRecord,
} from '@/types'
import { get } from './utils'

export function fetchTaskmillJobDemoSnapshot() {
  return get<TaskmillJobDemoSnapshot>('/job-demo/snapshot')
}

export interface TaskmillJobDemoHistoryParams {
  limit?: number
  offset?: number
}

export function taskmillJobDemoHistoryQueryKey(params: TaskmillJobDemoHistoryParams) {
  return ['taskmill-job-demo-history', params] as const
}

export function fetchTaskmillJobDemoHistory(
  params: TaskmillJobDemoHistoryParams = {},
) {
  return get<TaskmillTaskHistoryRecord[], TaskmillJobDemoHistoryParams>(
    '/job-demo/history',
    {
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    },
  )
}

export interface TaskmillJobDemoExecLogParams {
  limit?: number
}

export function taskmillJobDemoExecLogQueryKey(
  params: TaskmillJobDemoExecLogParams,
) {
  return ['taskmill-job-demo-exec-log', params] as const
}

export function fetchTaskmillJobDemoExecLog(
  params: TaskmillJobDemoExecLogParams = {},
) {
  return get<TaskmillDemoExecLogEntry[], TaskmillJobDemoExecLogParams>(
    '/job-demo/exec-log',
    {
      limit: params.limit ?? 250,
    },
  )
}
