import { axiosInstance } from './axios-instance'

export interface TaskmillSubtitlePreviewItem {
  start_cs: number
  end_cs: number
  text: string
}

export interface TaskmillSubtitlePreview {
  task_id: number
  updated_at: string
  completed: boolean
  items: TaskmillSubtitlePreviewItem[]
}

export function taskSubtitlePreviewJobs(taskId: number, signal?: AbortSignal) {
  return axiosInstance<TaskmillSubtitlePreview>({
    method: 'GET',
    url: `/api/jobs/tasks/${taskId}/subtitle-preview`,
    signal,
  })
}

export function getTaskSubtitlePreviewJobsQueryKey(taskId: number | null | undefined) {
  return ['/api/jobs/tasks', taskId, 'subtitle-preview'] as const
}
