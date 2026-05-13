/** 反序列化字幕文本 */
export function deserializeSubtitleText(text: string) {
  return text.split('\n').map((line) => {
    const [time, text] = line.split(' --> ')
    return {
      startTime: time.trim(),
      endTime: time.trim(),
      text: text.trim(),
    }
  }).filter(item => item.startTime && item.endTime && item.text)
}
