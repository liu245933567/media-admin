import type {
  MediaRootCreateReq,
  MediaRootRow,
  MediaVideoDeleteReq,
  MediaVideoDeleteRes,
  MediaVideosPageRes,
  MediaVideosQuery,
} from '@/types'
import { del, get, post } from './utils'

export const mediaRootsQueryKey = ['media-library', 'roots'] as const

export function fetchMediaRoots() {
  return get<MediaRootRow[]>('/media-library/roots')
}

export function createMediaRoot(params: MediaRootCreateReq) {
  return post<MediaRootRow, MediaRootCreateReq>('/media-library/roots', params)
}

export function deleteMediaRoot(id: number) {
  return del<boolean>(`/media-library/roots/${id}`)
}

export function enqueueMediaRootScan(id: number) {
  return post<unknown>(`/media-library/roots/${id}/scan`)
}

export function deleteMediaVideos(params: MediaVideoDeleteReq) {
  return post<MediaVideoDeleteRes, MediaVideoDeleteReq>(
    '/media-library/videos/delete',
    params,
  )
}

export interface MediaFilesParams {
  root_id?: number
  q?: string
  has_subtitle?: boolean
  current?: number
  page_size?: number
}

export function mediaFilesQueryKey(params: MediaFilesParams) {
  return ['media-library', 'files', params] as const
}

export function fetchMediaFiles(params: MediaFilesParams = {}) {
  return get<MediaVideosPageRes, MediaVideosQuery>('/media-library/files', {
    root_id: params.root_id,
    q: params.q,
    has_subtitle: params.has_subtitle,
    current: params.current ?? 1,
    page_size: params.page_size ?? 20,
  })
}
