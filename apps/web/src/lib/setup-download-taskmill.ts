import type { TaskmillJobSnapshot, TaskmillTaskRecord } from '@/types'
import type { TaskmillTaskHistoryRecord } from '@/types/taskmill-history'

/** 设置页下载任务在 UI 上的进度形态。 */
export interface SetupDownloadUiProgress {
  status: 'running' | 'done' | 'error'
  /** 0–100；无字节总量时来自 Taskmill 估计进度 */
  percent?: number
  bytesReceived?: number
  bytesTotal?: number | null
  message: string
}

/** 将 UI 进度转为 Progress 组件可用的 0–100 百分比。 */
export function uiProgressPercent(p: SetupDownloadUiProgress | null): number | undefined {
  if (!p)
    return undefined
  if (p.percent != null)
    return p.percent
  if (p.bytesTotal != null && p.bytesTotal > 0 && p.bytesReceived != null) {
    return Math.min(100, Math.round((100 * p.bytesReceived) / p.bytesTotal))
  }
  return undefined
}

/** 从活跃任务记录解析排队/运行中的进度（快照仅含 running 列表）。 */
export function mapSetupDownloadFromActiveRecord(
  record: TaskmillTaskRecord,
  snapshot?: TaskmillJobSnapshot,
): SetupDownloadUiProgress {
  if (record.status === 'running' && snapshot) {
    const fromSnap = mapSetupDownloadFromSnapshot(snapshot, record.id)
    if (fromSnap) {
      return fromSnap
    }
  }

  const statusHint: Record<TaskmillTaskRecord['status'], string> = {
    pending: '已入队，等待执行…',
    running: record.label || '正在下载…',
    paused: '任务已暂停',
    waiting: '等待子任务…',
    blocked: '等待依赖…',
  }

  return {
    status: 'running',
    message: statusHint[record.status] ?? record.label,
  }
}

/**
 * 从调度快照解析指定任务的运行中进度。
 * 任务不在 `running` 中时返回 `null`（应改查 history 或活跃列表）。
 */
export function mapSetupDownloadFromSnapshot(
  snapshot: TaskmillJobSnapshot,
  taskId: number,
): SetupDownloadUiProgress | null {
  const { scheduler } = snapshot
  const running = scheduler.running.find(t => t.id === taskId)
  if (!running) {
    return null
  }

  const byteProgress = scheduler.byte_progress.find(p => p.task_id === taskId)
  const estimated = scheduler.progress.find(p => p.header.task_id === taskId)

  let percent: number | undefined
  if (byteProgress?.bytes_total != null && byteProgress.bytes_total > 0) {
    percent = Math.min(
      100,
      Math.round((100 * byteProgress.bytes_completed) / byteProgress.bytes_total),
    )
  }
  else if (estimated != null) {
    percent = Math.min(100, Math.round(estimated.percent * 100))
  }

  return {
    status: 'running',
    percent,
    bytesReceived: byteProgress?.bytes_completed,
    bytesTotal: byteProgress?.bytes_total ?? null,
    message: running.label,
  }
}

/** 从历史记录解析终态进度。 */
export function mapSetupDownloadFromHistory(
  record: TaskmillTaskHistoryRecord,
): SetupDownloadUiProgress {
  if (record.status === 'completed') {
    return {
      status: 'done',
      percent: 100,
      message: record.label,
    }
  }
  return {
    status: 'error',
    message: record.last_error?.trim() || record.label || '下载失败',
  }
}

/** 任务是否仍在活跃队列（运行 / 等待 / 阻塞等）。 */
export function isTaskActiveInSnapshot(
  snapshot: TaskmillJobSnapshot,
  taskId: number,
): boolean {
  return snapshot.scheduler.running.some(t => t.id === taskId)
}

const WHISPER_DOWNLOAD_TASK_TYPE = 'whisper-model-download'
const WHISPER_DOWNLOAD_KEY_PREFIX = 'whisper-model-download:'

/** 从 Taskmill 去重键解析 Whisper 模型 id。 */
export function parseWhisperModelIdFromTaskKey(key: string): string | null {
  if (key.startsWith(WHISPER_DOWNLOAD_KEY_PREFIX)) {
    return key.slice(WHISPER_DOWNLOAD_KEY_PREFIX.length)
  }
  return null
}

export interface WhisperDownloadTaskRef {
  taskId: number
  modelId: string
  label: string
}

/** 快照中正在执行的 Whisper 模型下载任务。 */
export function listActiveWhisperDownloadTasks(
  snapshot: TaskmillJobSnapshot,
): WhisperDownloadTaskRef[] {
  return snapshot.scheduler.running
    .filter(t => t.task_type === WHISPER_DOWNLOAD_TASK_TYPE)
    .map((t) => {
      const modelId = parseWhisperModelIdFromTaskKey(t.key)
      if (!modelId) {
        return null
      }
      return { taskId: t.id, modelId, label: t.label }
    })
    .filter((x): x is WhisperDownloadTaskRef => x != null)
}

export type WhisperModelDownloadProgress = SetupDownloadUiProgress & {
  taskId: number
}

/** 按模型 id 聚合运行中的下载进度（来自 snapshot）。 */
export function buildWhisperDownloadProgressByModelId(
  snapshot: TaskmillJobSnapshot,
): Map<string, WhisperModelDownloadProgress> {
  const map = new Map<string, WhisperModelDownloadProgress>()
  for (const { taskId, modelId } of listActiveWhisperDownloadTasks(snapshot)) {
    const progress = mapSetupDownloadFromSnapshot(snapshot, taskId)
    if (progress) {
      map.set(modelId, { ...progress, taskId })
    }
  }
  return map
}

export function hasActiveWhisperDownloads(snapshot: TaskmillJobSnapshot): boolean {
  return listActiveWhisperDownloadTasks(snapshot).length > 0
}
