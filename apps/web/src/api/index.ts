export * from './axios-instance'
export * from './generated'
export * from './generated.schemas'
export * from './taskmill-exec-log'
export * from './taskmill-history'
export * from './taskmill-snapshot'

/** 本地视频流 URL（供 video.js / `<video>` 使用，支持 Range） */
export function buildLocalVideoSrc(path: string): string {
  return `/api/fs/video?path=${encodeURIComponent(path)}`
}

/** 转码后的 MP4 流 URL（须先完成转码） */
export function buildTranscodedVideoSrc(path: string): string {
  return `/api/fs/video/transcoded?path=${encodeURIComponent(path)}`
}

/** Emby 视频代理流 URL（供 video.js / `<video>` 使用，支持 Range） */
export function buildEmbyVideoSrc(itemId: string): string {
  return `/api/emby/stream?item_id=${encodeURIComponent(itemId)}`
}

/** Emby 后台转码代理流 URL（原始流无法播放时回退使用） */
export function buildEmbyTranscodedVideoSrc(itemId: string): string {
  return `/api/emby/transcode?item_id=${encodeURIComponent(itemId)}`
}

/** Emby 图片代理 URL */
export function buildEmbyImageSrc(itemId: string, tag?: string | null, imageType?: string): string {
  const params = new URLSearchParams()
  if (tag)
    params.set('tag', tag)
  if (imageType)
    params.set('image_type', imageType)
  const qs = params.toString()
  return `/api/emby/items/${encodeURIComponent(itemId)}/image${qs ? `?${qs}` : ''}`
}
