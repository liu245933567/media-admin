const API_PREFIX = import.meta.env.VITE_API_URL ?? ''

export function apiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${API_PREFIX}${p}`
}

export type SubtitleWebSearchRes = {
  video_path: string
  cid: string
  items: SubtitleItem[]
}

export type SubtitleItem = {
  id: string
  name: string
  langs: string
  ext: string
  is_hash_match: boolean
}

export type DownloadResponse = {
  subtitle_path: string
  record_id: number
}

export async function searchSubtitles(videoPath: string): Promise<SubtitleWebSearchRes> {
  const res = await fetch(apiUrl('/api/subtitles/search'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_path: videoPath }),
  })
  const data = (await res.json()) as { error?: string } & Partial<SubtitleWebSearchRes>
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`)
  }
  return data as SubtitleWebSearchRes
}

export type LocalJobDetail = {
  bytes_downloaded?: number
  total_bytes?: number
  current_segment?: number
  total_segments?: number
  video_path?: string
  subtitle_path?: string
  /** Whisper 转写阶段逐行日志 */
  whisper_logs?: string[]
}

export type LocalSubtitleJob = {
  id: string
  status: string
  phase: string
  progress: number
  message: string
  detail?: LocalJobDetail
  video_path?: string
  subtitle_path?: string
  error?: string
  created_at: string
  updated_at: string
}

export type CreateLocalJobResponse = {
  job_id: string
  reused: boolean
}

export async function createLocalSubtitleJob(
  videoPath: string,
): Promise<CreateLocalJobResponse> {
  const res = await fetch(apiUrl('/api/local-subtitles/jobs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_path: videoPath }),
  })
  const data = (await res.json()) as { error?: string } & Partial<CreateLocalJobResponse>
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`)
  }
  return data as CreateLocalJobResponse
}

export async function getLocalSubtitleJob(
  jobId: string,
): Promise<LocalSubtitleJob> {
  const res = await fetch(apiUrl(`/api/local-subtitles/jobs/${jobId}`))
  const data = (await res.json()) as { error?: string } & Partial<LocalSubtitleJob>
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`)
  }
  return data as LocalSubtitleJob
}

export async function listLocalSubtitleJobs(opts?: {
  status?: string
  limit?: number
}): Promise<LocalSubtitleJob[]> {
  const sp = new URLSearchParams()
  if (opts?.status) sp.set('status', opts.status)
  if (opts?.limit != null) sp.set('limit', String(opts.limit))
  const q = sp.toString()
  const path =
    q.length > 0
      ? `/api/local-subtitles/jobs?${q}`
      : '/api/local-subtitles/jobs'
  const res = await fetch(apiUrl(path))
  const data = (await res.json()) as { error?: string } | LocalSubtitleJob[]
  if (!res.ok) {
    const err = data as { error?: string }
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return data as LocalSubtitleJob[]
}

export async function downloadSubtitle(
  videoPath: string,
  subtitleId: string,
): Promise<DownloadResponse> {
  const res = await fetch(apiUrl('/api/subtitles/download'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ video_path: videoPath, subtitle_id: subtitleId }),
  })
  const data = (await res.json()) as { error?: string } & Partial<DownloadResponse>
  if (!res.ok) {
    throw new Error(data.error ?? `HTTP ${res.status}`)
  }
  return data as DownloadResponse
}
