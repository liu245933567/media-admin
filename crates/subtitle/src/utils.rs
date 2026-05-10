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

/// 判断 whisper 检测到的源语种短代码与翻译目标语言名是否一致。
///
/// whisper 给出的是 ISO-639-1 短代码（"zh"/"en"/...），
/// 而 `TranslateOptions::target_language` 通常是 "Chinese"/"English"
/// 等英文名（也接受短代码 / 中文别名），这里做最常见映射的对齐。
pub fn same_language(src_short: &str, target: &str) -> bool {
    let s = src_short.trim().to_ascii_lowercase();
    let t = target.trim().to_ascii_lowercase();
    if s == t {
        return true;
    }
    let target_short = match t.as_str() {
        "chinese" | "zh" | "zh-cn" | "中文" | "简体中文" => "zh",
        "english" | "en" | "英文" | "英语" => "en",
        "japanese" | "ja" | "日文" | "日语" => "ja",
        "korean" | "ko" | "韩文" | "韩语" => "ko",
        "french" | "fr" | "法语" => "fr",
        "german" | "de" | "德语" => "de",
        "spanish" | "es" | "西班牙语" => "es",
        "russian" | "ru" | "俄语" => "ru",
        other => other,
    };
    s == target_short
}
