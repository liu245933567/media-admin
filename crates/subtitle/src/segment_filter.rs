//! 识别结果清洗：剔除无效/重复条目，减少 SRT 体积与翻译 API 浪费。

use ma_whisper::types::WhisperTranscribeItem;

/// 合并相邻重复条目的最大时间间隔（百毫秒，30s = 3000cs）
const DEDUPE_GAP_CS: i64 = 3000;

/// 过短且文本极短则视为噪声（百毫秒）
const MIN_MEANINGFUL_DUR_CS: i64 = 25;

/// 归一化文本用于去重比较
pub fn normalize_dedupe_key(text: &str) -> String {
    let mut t = text.trim().to_lowercase();
    if t.starts_with('*') && t.ends_with('*') && t.len() >= 2 {
        t = t[1..t.len() - 1].trim().to_string();
    }
    t = t
        .trim_matches(|c: char| {
            matches!(
                c,
                '-' | '—' | '–' | '.' | ',' | '!' | '?' | '…' | '。' | '，' | '！' | '？'
            )
        })
        .to_string();
    t.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 是否为无意义条目（不写 SRT、不调用翻译 API）
pub fn is_meaningless_segment(text: &str, dur_cs: i64) -> bool {
    let t = text.trim();
    if t.is_empty() {
        return true;
    }

    if t == "-" || t == "—" || t == "–" {
        return true;
    }

    if t.chars()
        .all(|c| c.is_ascii_punctuation() || c.is_whitespace() || matches!(c, '*' | '…'))
    {
        return true;
    }

    if t.starts_with('*') && t.ends_with('*') {
        return true;
    }

    let key = normalize_dedupe_key(t);
    if key.is_empty() {
        return true;
    }

    if is_filler_only(&key) {
        return true;
    }

    let chars = t.chars().count();
    if dur_cs < MIN_MEANINGFUL_DUR_CS && chars <= 3 {
        return true;
    }

    false
}

/// 是否值得调用翻译 API（已通过 [`is_meaningless_segment`] 的条目）
pub fn is_translatable_segment(item: &WhisperTranscribeItem) -> bool {
    let dur = item.end_cs.saturating_sub(item.start_cs);
    if is_meaningless_segment(&item.text, dur) {
        return false;
    }
    let t = item.text.trim();
    let chars = t.chars().count();
    if chars < 2 {
        return false;
    }
    let key = normalize_dedupe_key(t);
    !key.is_empty() && !is_filler_only(&key)
}

fn is_filler_only(key: &str) -> bool {
    const FILLERS: &[&str] = &[
        "oh", "ooh", "um", "uh", "ah", "ha", "huh", "hmm", "mmm", "mm", "mm-hmm", "mhm", "yeah",
        "yep", "nah", "ok", "okay", "wow", "嗯", "啊", "哦", "呃", "唔", "哼", "唉", "诶", "呀",
        "哈", "唔嗯", "嗯嗯",
    ];
    FILLERS.contains(&key)
}

/// 将单条识别结果并入已清洗列表；返回 `true` 表示已丢弃或与上条合并。
fn merge_one_sanitized(out: &mut Vec<WhisperTranscribeItem>, item: WhisperTranscribeItem) -> bool {
    let dur = item.end_cs.saturating_sub(item.start_cs);
    if is_meaningless_segment(&item.text, dur) {
        return true;
    }

    let key = normalize_dedupe_key(&item.text);
    if let Some(last) = out.last_mut() {
        let last_key = normalize_dedupe_key(&last.text);
        let gap = item.start_cs.saturating_sub(last.end_cs);
        if last_key == key && gap <= DEDUPE_GAP_CS {
            last.end_cs = last.end_cs.max(item.end_cs);
            return true;
        }
    }
    out.push(item);
    false
}

/// 将新一 VAD 区间的识别结果增量合并进已清洗列表（按时间序，剔除无效/近邻重复）。
pub fn merge_interval_into_sanitized(
    out: &mut Vec<WhisperTranscribeItem>,
    mut interval_items: Vec<WhisperTranscribeItem>,
) {
    interval_items.sort_by_key(|s| s.start_cs);
    let before = out.len();
    let mut dropped = 0usize;
    for item in interval_items {
        if merge_one_sanitized(out, item) {
            dropped += 1;
        }
    }
    if dropped > 0 {
        tracing::debug!(
            "[subtitle] 区间清洗: 丢弃/合并 {dropped} 条，累计 {} 条",
            out.len()
        );
    } else if out.len() > before {
        tracing::debug!(
            "[subtitle] 区间清洗: 新增 {} 条，累计 {} 条",
            out.len() - before,
            out.len()
        );
    }
}

/// 排序 → 剔除无效 → 合并相邻/近邻重复。
pub fn sanitize_whisper_segments(items: Vec<WhisperTranscribeItem>) -> Vec<WhisperTranscribeItem> {
    let raw_len = items.len();
    let mut out = Vec::with_capacity(raw_len);
    merge_interval_into_sanitized(&mut out, items);
    if out.len() < raw_len {
        tracing::info!(
            "[subtitle] 清洗字幕段: 保留 {} 条（原始 {} 条）",
            out.len(),
            raw_len
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start: i64, end: i64, text: &str) -> WhisperTranscribeItem {
        WhisperTranscribeItem {
            start_cs: start,
            end_cs: end,
            text: text.to_string(),
        }
    }

    #[test]
    fn drops_filler_and_dash() {
        assert!(is_meaningless_segment("-", 100));
        assert!(is_meaningless_segment("Oh", 50));
        assert!(is_meaningless_segment("*coughs*", 200));
        assert!(!is_meaningless_segment("Hello world", 200));
    }

    #[test]
    fn incremental_merge_dedupes_across_intervals() {
        let mut out = vec![seg(0, 10, "Thank you")];
        merge_interval_into_sanitized(&mut out, vec![seg(11, 20, "thank you.")]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].end_cs, 20);
    }

    #[test]
    fn merges_consecutive_duplicates() {
        let raw = vec![
            seg(0, 10, "Thank you"),
            seg(11, 20, "thank you."),
            seg(100, 110, "Real line here"),
        ];
        let out = sanitize_whisper_segments(raw);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].text, "Thank you");
        assert_eq!(out[0].end_cs, 20);
    }

    #[test]
    fn translatable_skips_filler() {
        let s = seg(0, 100, "Oh");
        assert!(!is_translatable_segment(&s));
        let s = seg(0, 100, "I want more");
        assert!(is_translatable_segment(&s));
    }
}
