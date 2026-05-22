import type { MediaVideoRow } from '@/types/api'
import { isPlayableSubtitleFile } from '@/utils/video-path'

export interface VideoPlaySearch {
  videoPath: string
  subtitles?: string
  subtitle?: string
  /** 媒体库资源路径 ID，用于上一个/下一个切换 */
  rootId?: number
}

/** 从媒体库视频条目构造播放页 search 参数。 */
export function buildVideoPlaySearch(
  item: Pick<MediaVideoRow, 'file_path' | 'subtitles' | 'root_id'>,
): VideoPlaySearch {
  const subtitles = (item.subtitles ?? [])
    .map(subtitle => subtitle.file_name)
    .filter(isPlayableSubtitleFile)
    .join(',')
  const search: VideoPlaySearch = { videoPath: item.file_path }
  if (subtitles)
    search.subtitles = subtitles
  search.rootId = Number(item.root_id)
  return search
}
