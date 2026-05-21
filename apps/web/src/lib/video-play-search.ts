import type { VideoFolderScanItem } from '@/types/api'
import { isPlayableSubtitleFile } from '@/utils/video-path'

export interface VideoPlaySearch {
  videoPath: string
  subtitles?: string
  subtitle?: string
  /** 与「本地视频」扫描目录一致时，用于上一个/下一个切换 */
  rootDir?: string
}

/** 从扫描条目构造播放页 search 参数（含同目录播放列表用的 rootDir） */
export function buildVideoPlaySearch(
  item: Pick<VideoFolderScanItem, 'video_path' | 'subtitle_names'>,
  rootDir?: string,
): VideoPlaySearch {
  const subtitles = (item.subtitle_names ?? [])
    .filter(isPlayableSubtitleFile)
    .join(',')
  const search: VideoPlaySearch = { videoPath: item.video_path }
  if (subtitles)
    search.subtitles = subtitles
  const dir = rootDir?.trim()
  if (dir)
    search.rootDir = dir
  return search
}
