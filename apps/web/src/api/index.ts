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
