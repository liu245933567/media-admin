export interface SubtitleTextItem {
  startTime: string
  endTime: string
  text: string
}

const SRT_TIME_LINE_RE = /^(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})(?:[^\S\r\n][^\r\n]*)?$/

/** 反序列化 SRT 字幕文本 */
export function deserializeSubtitleText(text: string): SubtitleTextItem[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')

  const subtitles: SubtitleTextItem[] = []
  let index = 0

  while (index < lines.length) {
    let line = lines[index].trim()

    if (!line) {
      index += 1
      continue
    }

    if (/^\d+$/.test(line) && index + 1 < lines.length) {
      index += 1
      line = lines[index].trim()
    }

    const timeMatch = line.match(SRT_TIME_LINE_RE)

    if (!timeMatch) {
      index += 1
      continue
    }

    const [, startTime, endTime] = timeMatch
    const textLines: string[] = []

    index += 1

    while (index < lines.length && lines[index].trim()) {
      textLines.push(lines[index].trim())
      index += 1
    }

    const subtitleText = textLines.join('\n').trim()

    if (subtitleText) {
      subtitles.push({
        startTime,
        endTime,
        text: subtitleText,
      })
    }
  }

  return subtitles
}
