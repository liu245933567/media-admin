import { deserializeSubtitleText } from '@/utils/subtitle'

function srtTimestampToVtt(time: string): string {
  return time.replace(',', '.')
}

/** 将 SRT 文本转为 WebVTT */
export function srtTextToVtt(srtText: string): string {
  const items = deserializeSubtitleText(srtText)
  const lines = ['WEBVTT', '']
  for (const item of items) {
    lines.push(`${srtTimestampToVtt(item.startTime)} --> ${srtTimestampToVtt(item.endTime)}`)
    lines.push(item.text)
    lines.push('')
  }
  return lines.join('\n')
}

/** 根据磁盘路径与文件内容生成可用于 `<track>` / video.js 的 blob URL */
export function createSubtitleBlobUrl(filePath: string, rawText: string): string {
  const lower = filePath.toLowerCase()
  let vtt: string
  if (lower.endsWith('.vtt')) {
    vtt = rawText.trimStart().startsWith('WEBVTT') ? rawText : `WEBVTT\n\n${rawText}`
  }
  else {
    vtt = srtTextToVtt(rawText)
  }
  const blob = new Blob([vtt], { type: 'text/vtt;charset=utf-8' })
  return URL.createObjectURL(blob)
}
