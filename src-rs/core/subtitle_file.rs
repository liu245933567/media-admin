use crate::core::whisper::WhisperTranscribeItem;
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};

/// SRT 单条记录（保留原时间戳行，避免重新格式化引入差异）
#[derive(Clone, Debug)]
pub struct SrtEntry {
    /// 原文件中的序号（仅作参考，写出时按顺序重新编号）
    pub index: usize,
    /// 原始时间戳行，例如 `00:00:01,000 --> 00:00:03,000`
    pub time_line: String,
    /// 字幕文本，可能含多行
    pub text: String,
}

/// 解析 SRT 文本为条目列表。容忍 BOM、CRLF 与多余空行。
pub fn parse_srt(content: &str) -> Result<Vec<SrtEntry>> {
    let trimmed = content.trim_start_matches('\u{feff}');
    let normalized = trimmed.replace("\r\n", "\n").replace('\r', "\n");

    let mut entries = Vec::new();
    for block in normalized.split("\n\n") {
        let block = block.trim_matches('\n');
        if block.is_empty() {
            continue;
        }
        let mut lines = block.lines();
        let first = lines.next().ok_or_else(|| anyhow!("SRT 块为空"))?.trim();

        // 第一行可能是序号，也可能直接是时间戳（容错）
        let (index, time_line) = if first.contains("-->") {
            (entries.len() + 1, first.to_string())
        } else {
            let idx: usize = first.parse().unwrap_or(entries.len() + 1);
            let time = lines
                .next()
                .ok_or_else(|| anyhow!("SRT 缺少时间戳行: {first}"))?
                .trim()
                .to_string();
            (idx, time)
        };

        let text = lines.collect::<Vec<_>>().join("\n");
        entries.push(SrtEntry {
            index,
            time_line,
            text,
        });
    }
    Ok(entries)
}

/// 将条目重新组装为 SRT 文本（按顺序重新编号）。
pub fn build_srt(entries: &[SrtEntry]) -> String {
    let mut out = String::new();
    for (i, e) in entries.iter().enumerate() {
        out.push_str(&format!("{}\n", i + 1));
        out.push_str(e.time_line.trim());
        out.push('\n');
        out.push_str(e.text.trim_end());
        out.push_str("\n\n");
    }
    out
}

/// 格式化 SRT 时间戳
///
/// 入参 `cs` 单位为百毫秒（1cs = 10ms）。负值会被 saturate 到 0，
/// 但 debug 构建会触发断言提醒上游 BUG。
pub fn fmt_srt_ts_centiseconds(cs: i64) -> String {
    debug_assert!(cs >= 0, "fmt_srt_ts_centiseconds 收到负值: {cs}");
    let ms_total: u64 = cs.saturating_mul(10).max(0) as u64;
    let h = ms_total / 3_600_000;
    let m = (ms_total / 60_000) % 60;
    let s = (ms_total / 1_000) % 60;
    let ms = ms_total % 1_000;
    format!("{h:02}:{m:02}:{s:02},{ms:03}")
}

/// 写入 SRT 文件
///
/// - `video_path`：视频文件路径
/// - `srt_path`：SRT 输出路径。为 `None` 时与视频同目录、同主名自动生成；
///   若同时提供 `lang`，会按媒体播放器约定追加语言代码：`<basename>.<lang>.srt`
///   （例如 `movie.zh.srt` / `movie.en.srt`）。
/// - `segments`：语音识别结果
/// - `lang`：识别到的语言短代码（如 `"zh"`、`"en"`）。
///   仅在 `srt_path == None` 且非空时影响文件名；为 `None` 时退化为 `<basename>.srt`。
pub fn write_srt_file(
    video_path: &Path,
    srt_path: Option<&Path>,
    segments: &[WhisperTranscribeItem],
    lang: Option<&str>,
) -> Result<PathBuf> {
    let mut out = String::new();
    let mut idx = 1usize;
    for seg in segments {
        let text = seg.text.trim();
        if text.is_empty() {
            continue;
        }

        // SRT 要求 end > start；若相等则让 end + 1cs（10ms）
        let s0 = seg.start_cs;
        let mut s1 = seg.end_cs;
        if s1 <= s0 {
            s1 = s0 + 1;
        }

        out.push_str(&format!("{idx}\n"));
        out.push_str(&format!(
            "{} --> {}\n",
            fmt_srt_ts_centiseconds(s0),
            fmt_srt_ts_centiseconds(s1)
        ));
        out.push_str(text);
        out.push_str("\n\n");
        idx += 1;
    }

    let srt_path: PathBuf = match srt_path {
        Some(p) => p.to_path_buf(),
        None => default_srt_path(video_path, lang),
    };

    std::fs::write(&srt_path, out)?;

    Ok(srt_path)
}

/// 根据视频路径和（可选的）语言代码，按 Plex/Jellyfin/Kodi 等播放器
/// 通用约定计算默认 SRT 输出路径：
/// - `lang = Some("zh")` → `movie.zh.srt`
/// - `lang = None` 或空串 → `movie.srt`
fn default_srt_path(video_path: &Path, lang: Option<&str>) -> PathBuf {
    let lang_tag = lang
        .map(str::trim)
        .filter(|s| !s.is_empty() && is_safe_lang_tag(s));

    let mut p = video_path.to_path_buf();
    match lang_tag {
        Some(l) => {
            // 用 file_stem 而不是 set_extension，避免视频本身没有扩展名时丢主名
            let stem = video_path
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default();
            p.set_file_name(format!("{stem}.{l}.srt"));
        }
        None => {
            p.set_extension("srt");
        }
    }
    p
}

/// 仅允许 ASCII 字母 / 数字 / `-` / `_`，避免奇怪的 lang 字符串污染文件名
fn is_safe_lang_tag(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 16
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}
