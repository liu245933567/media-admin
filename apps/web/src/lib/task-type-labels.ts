/** 已知 Taskmill 任务类型 → 展示名（新类型未配置时回退为原始 task_type） */
export const TASK_TYPE_LABELS: Record<string, string> = {
  'video-subtitle-generate': '字幕生成',
  'subtitle-translate': '字幕翻译',
  'whisper-model-download': '下载 Whisper 模型',
  'ffmpeg-setup-download': '下载 FFmpeg',
  /** 旧三段子任务链，仅历史 SQLite 记录展示 */
  'extract-wav': '提取 WAV（已废弃）',
  'whisper-vad-srt': '识别字幕（已废弃）',
}

export function taskTypeLabel(taskType: string): string {
  return TASK_TYPE_LABELS[taskType] ?? taskType
}

/** 从任务记录中收集出现过的类型，已知类型按固定顺序，其余按字母序排在后面 */
export function collectTaskTypes(
  types: Iterable<string>,
  knownOrder: string[] = Object.keys(TASK_TYPE_LABELS),
): string[] {
  const set = new Set(types)
  const ordered: string[] = []
  for (const t of knownOrder) {
    if (set.has(t)) {
      ordered.push(t)
      set.delete(t)
    }
  }
  ordered.push(...[...set].sort())
  return ordered
}
