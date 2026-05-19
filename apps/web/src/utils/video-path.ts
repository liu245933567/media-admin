/** 取路径中的父目录 */
export function getParentPath(filePath: string): string {
  const i1 = filePath.lastIndexOf('/')
  const i2 = filePath.lastIndexOf('\\')
  const i = Math.max(i1, i2)
  if (i < 0)
    return ''
  return filePath.slice(0, i)
}

/** 将文件名拼到视频所在目录 */
export function joinVideoDir(videoPath: string, filename: string): string {
  const i1 = videoPath.lastIndexOf('/')
  const i2 = videoPath.lastIndexOf('\\')
  const i = Math.max(i1, i2)
  if (i < 0)
    return filename
  const base = videoPath.slice(0, i + 1)
  return `${base}${filename}`
}

/** 取路径最后一段文件名 */
export function getFileName(filePath: string): string {
  const i1 = filePath.lastIndexOf('/')
  const i2 = filePath.lastIndexOf('\\')
  const i = Math.max(i1, i2)
  if (i < 0)
    return filePath
  return filePath.slice(i + 1)
}

/** 取文件名（不含扩展名） */
export function getFileStem(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot < 0)
    return name
  return name.slice(0, dot)
}

/** 首版播放器仅支持 SRT / VTT */
export function isPlayableSubtitleFile(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith('.srt') || lower.endsWith('.vtt')
}
