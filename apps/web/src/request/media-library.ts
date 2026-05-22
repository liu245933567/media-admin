import type {
  MediaFileType,
  MediaFilesPageRes,
  MediaFilesQuery,
  MediaRootCreateReq,
  MediaRootRow,
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

export interface MediaFilesParams {
  root_id?: number
  file_type?: MediaFileType
  q?: string
  current?: number
  page_size?: number
}

export function mediaFilesQueryKey(params: MediaFilesParams) {
  return ['media-library', 'files', params] as const
}

export function fetchMediaFiles(params: MediaFilesParams = {}) {
  return get<MediaFilesPageRes, MediaFilesQuery>('/media-library/files', {
    root_id: params.root_id,
    file_type: params.file_type,
    q: params.q,
    current: params.current ?? 1,
    page_size: params.page_size ?? 20,
  })
}
