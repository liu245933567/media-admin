import { getFileName, getFileStem } from '@/utils/video-path'

export interface SubtitleTrackLike {
  label: string
  path: string
}

const CHINESE_LANG_TAGS = new Set([
  'zh',
  'zh-cn',
  'zh-tw',
  'zh-hans',
  'zh-hant',
  'chs',
  'cht',
  'sc',
  'tc',
  'cn',
])

const ENGLISH_LANG_TAGS = new Set(['en', 'eng', 'english'])

/** 从「视频主名.lang.ext」形式解析语言标签，如 `movie.zh.srt` → `zh` */
function parseLangTagFromLabel(label: string, videoStem: string): string | null {
  const stem = getFileStem(label).toLowerCase()
  const base = videoStem.toLowerCase()
  if (stem === base)
    return null
  const prefix = `${base}.`
  if (!stem.startsWith(prefix))
    return null
  return stem.slice(prefix.length)
}

function isChineseLangTag(tag: string): boolean {
  const t = tag.toLowerCase()
  if (CHINESE_LANG_TAGS.has(t))
    return true
  return t.startsWith('zh-') || t.includes('中文') || t.includes('简体') || t.includes('繁体')
}

function isEnglishLangTag(tag: string): boolean {
  const t = tag.toLowerCase()
  return ENGLISH_LANG_TAGS.has(t) || t.startsWith('en-') || t.includes('英文') || t.includes('英语')
}

function hasChineseKeywordInName(label: string): boolean {
  const lower = label.toLowerCase()
  return /\.(?:zh|chs|cht)(?:\.|$)/.test(lower)
    || /chinese|mandarin|cantonese|中文|简体|繁体/.test(lower)
}

/** 为字幕轨打分，分数越高越优先作为默认中文字幕 */
function scoreSubtitleTrack(label: string, videoStem: string): number {
  const tag = parseLangTagFromLabel(label, videoStem)
  if (tag !== null) {
    if (isEnglishLangTag(tag))
      return -100
    if (isChineseLangTag(tag)) {
      if (tag === 'zh')
        return 100
      if (tag.startsWith('zh'))
        return 90
      return 80
    }
    return 10
  }

  if (getFileStem(label).toLowerCase() === videoStem.toLowerCase())
    return 50

  if (hasChineseKeywordInName(label))
    return 70

  return 0
}

/**
 * 解析默认应展示的字幕轨：优先显式指定，其次中文命名轨（`.zh.srt` 等），再退化为同主名轨。
 */
export function resolveDefaultChineseSubtitlePath(
  videoPath: string,
  tracks: SubtitleTrackLike[],
  preferredLabel?: string,
): string | undefined {
  if (!tracks.length)
    return undefined

  if (preferredLabel) {
    const hit = tracks.find(t => t.label === preferredLabel)
    if (hit)
      return hit.path
  }

  const videoStem = getFileStem(getFileName(videoPath))
  const ranked = [...tracks]
    .map(track => ({ track, score: scoreSubtitleTrack(track.label, videoStem) }))
    .sort((a, b) => b.score - a.score)

  const preferred = ranked.find(r => r.score > 0) ?? ranked.find(r => r.score >= 0)
  return (preferred?.track ?? tracks[0]).path
}
