use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use async_openai::{
    config::OpenAIConfig,
    error::OpenAIError,
    types::chat::{
        ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequest,
        CreateChatCompletionRequestArgs,
    },
    Client,
};
use futures::stream::{self, StreamExt};

use crate::core::subtitle_file::{build_srt, parse_srt};

/// 硅基流动 OpenAI 兼容 API 基地址
pub const SILICONFLOW_API_BASE: &str = "https://api.siliconflow.cn/v1";

/// 默认翻译模型: 腾讯混元 MT-7B
pub const HUNYUAN_MT_MODEL: &str = "tencent/Hunyuan-MT-7B";

/// 翻译并发数上限（硅基流动有 RPM 限制，过大易触发 429）
const DEFAULT_CONCURRENCY: usize = 4;

/// 单条翻译请求的最长等待时间（含网络 + 服务端推理）
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// 失败重试次数上限（不含首次请求）
const MAX_RETRIES: u32 = 3;

/// 重试初始退避时间，每次失败翻倍，封顶 8 秒
const RETRY_INITIAL_DELAY: Duration = Duration::from_millis(800);
const RETRY_MAX_DELAY: Duration = Duration::from_secs(8);

/// 默认批量翻译的单批字幕条数
const DEFAULT_BATCH_SIZE: usize = 8;

/// 单次批量请求的 max_tokens 上限
const BATCH_MAX_TOKENS_CAP: u32 = 4096;

/// 批量 prompt 中分隔符的前后缀，遇到 `<<<N>>>` 行视为新段开始
const BATCH_DELIM_PREFIX: &str = "<<<";
const BATCH_DELIM_SUFFIX: &str = ">>>";

/// 翻译选项
#[derive(Clone, Debug)]
pub struct TranslateOptions {
    /// 模型名，默认 `tencent/Hunyuan-MT-7B`
    pub model: String,
    /// 目标语言，例如 "Chinese"、"English"、"Japanese"
    pub target_language: String,
    /// 并发数（同时在飞的请求数）
    pub concurrency: usize,
    /// 单批字幕条数。`>1` 时启用批量上下文翻译，`=1` 走逐条翻译。
    pub batch_size: usize,
}

impl Default for TranslateOptions {
    fn default() -> Self {
        Self {
            model: HUNYUAN_MT_MODEL.to_string(),
            target_language: "Chinese".to_string(),
            concurrency: DEFAULT_CONCURRENCY,
            batch_size: DEFAULT_BATCH_SIZE,
        }
    }
}

/// 创建一个连接到硅基流动的 OpenAI 兼容客户端。
pub fn build_siliconflow_client() -> Result<Client<OpenAIConfig>> {
    let key = std::env::var("SILICONFLOW_API_KEY")
        .map_err(|_| anyhow!("缺少环境变量 SILICONFLOW_API_KEY"))?
        .trim()
        .to_string();
    let config = OpenAIConfig::new()
        .with_api_base(SILICONFLOW_API_BASE)
        .with_api_key(key);

    let http = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .context("构建 HTTP 客户端失败")?;

    Ok(Client::with_config(config).with_http_client(http))
}

/// 估算单条字幕需要的 `max_tokens`，避免长字幕被截断
fn estimate_max_tokens(text: &str) -> u32 {
    let n = text.chars().count() as u32;
    n.saturating_mul(3).saturating_add(64).clamp(64, 2048)
}

/// 估算批量请求的 `max_tokens`：原文总字符数 ×3 + 分隔符开销，封顶 [`BATCH_MAX_TOKENS_CAP`]
fn estimate_batch_max_tokens(segments: &[&str]) -> u32 {
    let total_chars: usize = segments.iter().map(|s| s.chars().count()).sum();
    let delim_overhead = (segments.len() as u32).saturating_mul(8);
    let estimated = (total_chars as u32)
        .saturating_mul(3)
        .saturating_add(delim_overhead)
        .saturating_add(128);
    estimated.clamp(128, BATCH_MAX_TOKENS_CAP)
}

/// 构造一次单条翻译请求
fn build_translate_request(
    model: &str,
    target_language: &str,
    text: &str,
) -> Result<CreateChatCompletionRequest> {
    let prompt = format!(
        "Translate the following segment into {target_language}, without additional explanation.\n\n{text}"
    );

    let user_msg = ChatCompletionRequestUserMessageArgs::default()
        .content(prompt)
        .build()?;

    let max_tokens = estimate_max_tokens(text);

    // `max_tokens` 在 async-openai 0.38 中标记为 deprecated（推荐 max_completion_tokens），
    // 但硅基流动/Hunyuan-MT 仍以 max_tokens 为准，这里继续使用。
    #[allow(deprecated)]
    let req = CreateChatCompletionRequestArgs::default()
        .model(model)
        .messages(vec![user_msg.into()])
        .temperature(0.0)
        .max_tokens(max_tokens)
        .build()?;

    Ok(req)
}

/// 构造一次批量翻译请求
fn build_batch_request(
    model: &str,
    target_language: &str,
    segments: &[&str],
) -> Result<CreateChatCompletionRequest> {
    let prompt = build_batch_prompt(target_language, segments);
    let max_tokens = estimate_batch_max_tokens(segments);

    let user_msg = ChatCompletionRequestUserMessageArgs::default()
        .content(prompt)
        .build()?;

    #[allow(deprecated)]
    let req = CreateChatCompletionRequestArgs::default()
        .model(model)
        .messages(vec![user_msg.into()])
        .temperature(0.0)
        .max_tokens(max_tokens)
        .build()?;

    Ok(req)
}

/// 构造批量翻译 prompt：每条字幕用 `<<<N>>>` 分隔，要求模型按相同格式返回。
fn build_batch_prompt(target_language: &str, segments: &[&str]) -> String {
    let n = segments.len();
    let mut s = String::new();
    s.push_str(&format!(
        "You are translating consecutive subtitle segments. \
         Translate the following {n} segments into {target_language}.\n\
         Each segment is wrapped by a delimiter line `<<<N>>>` where N is its 1-based index. \
         Output exactly {n} segments using the same delimiter lines and the same order. \
         Translate the text only; preserve line breaks inside a segment. \
         Do not merge or skip any segment, do not add commentary or explanations.\n\n"
    ));
    for (i, text) in segments.iter().enumerate() {
        s.push_str(&format!("<<<{}>>>\n{}\n", i + 1, text));
    }
    s
}

/// 解析批量翻译返回。要求 1..=expected 全部出现且非空，否则报错由上层回退。
fn parse_batch_response(content: &str, expected: usize) -> Result<Vec<String>> {
    let mut found: Vec<Option<String>> = (0..expected).map(|_| None).collect();
    let mut current: Option<usize> = None;
    let mut buf: Vec<&str> = Vec::new();

    let commit = |idx: Option<usize>, buf: &mut Vec<&str>, found: &mut Vec<Option<String>>| {
        if let Some(i) = idx {
            if (1..=expected).contains(&i) && found[i - 1].is_none() {
                let text = buf.join("\n").trim().to_string();
                found[i - 1] = Some(text);
            }
        }
        buf.clear();
    };

    for line in content.lines() {
        if let Some(num) = parse_delimiter_line(line) {
            commit(current, &mut buf, &mut found);
            current = Some(num);
        } else if current.is_some() {
            buf.push(line);
        }
        // 在第一个分隔符出现前的内容（模型可能加的前言）一律忽略
    }
    commit(current, &mut buf, &mut found);

    let mut out = Vec::with_capacity(expected);
    for (i, t) in found.into_iter().enumerate() {
        match t {
            Some(s) if !s.is_empty() => out.push(s),
            Some(_) => return Err(anyhow!("批量返回第 {} 条为空", i + 1)),
            None => return Err(anyhow!("批量返回缺少第 {} 条", i + 1)),
        }
    }
    Ok(out)
}

/// 识别形如 `<<<3>>>`、`<<< 3 >>>`、`<<<#3>>>`、`**<<<3>>>**` 的分隔符行
fn parse_delimiter_line(line: &str) -> Option<usize> {
    let stripped = line.trim().trim_matches(|c: char| matches!(c, '*' | '`'));
    let stripped = stripped.trim();
    if !stripped.starts_with(BATCH_DELIM_PREFIX) || !stripped.ends_with(BATCH_DELIM_SUFFIX) {
        return None;
    }
    let inner = &stripped[BATCH_DELIM_PREFIX.len()..stripped.len() - BATCH_DELIM_SUFFIX.len()];
    let inner = inner.trim().trim_start_matches('#').trim();
    inner.parse::<usize>().ok()
}

/// 判断 OpenAIError 是否值得重试。
///
/// - 网络层错误（连接被打断、读超时等）→ 重试
/// - 服务端 5xx / 429 / 临时不可用 → 重试
/// - 其他（鉴权失败、参数错误、JSON 反序列化失败等永久错误）→ 不重试
fn is_retryable(err: &OpenAIError) -> bool {
    match err {
        OpenAIError::Reqwest(_) => true,
        OpenAIError::ApiError(api) => {
            let m = api.message.to_ascii_lowercase();
            m.contains("429")
                || m.contains("rate limit")
                || m.contains("too many requests")
                || m.contains("timeout")
                || m.contains("timed out")
                || m.contains("temporarily unavailable")
                || m.contains("service unavailable")
                || m.contains("bad gateway")
                || m.contains("gateway timeout")
                || m.contains("internal server error")
                || m.contains(" 500")
                || m.contains(" 502")
                || m.contains(" 503")
                || m.contains(" 504")
        }
        _ => false,
    }
}

/// 调用模型翻译一段文本（自带退避重试）。
async fn translate_one(
    client: &Client<OpenAIConfig>,
    model: &str,
    target_language: &str,
    text: &str,
) -> Result<String> {
    let mut delay = RETRY_INITIAL_DELAY;

    for attempt in 0..=MAX_RETRIES {
        let req = build_translate_request(model, target_language, text)?;
        match client.chat().create(req).await {
            Ok(resp) => {
                let content = resp
                    .choices
                    .into_iter()
                    .next()
                    .and_then(|c| c.message.content)
                    .ok_or_else(|| anyhow!("模型未返回翻译内容"))?;
                let cleaned = strip_translation_prefix(content.trim());
                return Ok(cleaned);
            }
            Err(e) => {
                if attempt < MAX_RETRIES && is_retryable(&e) {
                    tracing::debug!(
                        "翻译重试 {}/{}（退避 {:?}）: {:#}",
                        attempt + 1,
                        MAX_RETRIES,
                        delay,
                        e
                    );
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(RETRY_MAX_DELAY);
                    continue;
                }
                return Err(anyhow::Error::from(e));
            }
        }
    }

    // 上面循环要么 return Ok 要么 return Err，正常不会到这里
    Err(anyhow!("翻译失败但未捕获错误"))
}

/// 调用模型批量翻译一组字幕，返回与输入等长的译文列表。
///
/// 失败的情况：
/// - 网络/限流错误：指数退避重试
/// - 解析返回失败（行数对不齐、编号缺失、内容为空）：也会重试一次（提示模型重新生成）
async fn translate_batch(
    client: &Client<OpenAIConfig>,
    model: &str,
    target_language: &str,
    segments: &[&str],
) -> Result<Vec<String>> {
    let mut delay = RETRY_INITIAL_DELAY;
    let mut last_err: Option<anyhow::Error> = None;

    for attempt in 0..=MAX_RETRIES {
        let req = build_batch_request(model, target_language, segments)?;
        match client.chat().create(req).await {
            Ok(resp) => {
                let content = resp
                    .choices
                    .into_iter()
                    .next()
                    .and_then(|c| c.message.content)
                    .ok_or_else(|| anyhow!("模型未返回翻译内容"))?;
                match parse_batch_response(&content, segments.len()) {
                    Ok(translations) => {
                        let cleaned: Vec<String> = translations
                            .into_iter()
                            .map(|t| strip_translation_prefix(&t))
                            .collect();
                        return Ok(cleaned);
                    }
                    Err(e) => {
                        last_err = Some(e);
                        if attempt < MAX_RETRIES {
                            tracing::debug!(
                                "批量解析失败 {}/{}（退避 {:?}）: {:#}",
                                attempt + 1,
                                MAX_RETRIES,
                                delay,
                                last_err.as_ref().unwrap()
                            );
                            tokio::time::sleep(delay).await;
                            delay = (delay * 2).min(RETRY_MAX_DELAY);
                            continue;
                        }
                        return Err(last_err.unwrap());
                    }
                }
            }
            Err(e) => {
                let retryable = is_retryable(&e);
                if attempt < MAX_RETRIES && retryable {
                    tracing::debug!(
                        "批量翻译重试 {}/{}（退避 {:?}）: {:#}",
                        attempt + 1,
                        MAX_RETRIES,
                        delay,
                        e
                    );
                    tokio::time::sleep(delay).await;
                    delay = (delay * 2).min(RETRY_MAX_DELAY);
                    continue;
                }
                return Err(anyhow::Error::from(e));
            }
        }
    }

    Err(last_err.unwrap_or_else(|| anyhow!("批量翻译失败但未捕获错误")))
}

/// 去掉模型偶尔附带的 `Translation:` / `翻译：` 等前缀，以及包裹的引号。
fn strip_translation_prefix(s: &str) -> String {
    let mut out = s.trim();
    let prefixes = [
        "Translation:",
        "translation:",
        "TRANSLATION:",
        "翻译：",
        "翻译:",
        "译文：",
        "译文:",
    ];
    for p in prefixes {
        if let Some(rest) = out.strip_prefix(p) {
            out = rest.trim();
            break;
        }
    }
    out.trim_matches(|c: char| matches!(c, '"' | '\'' | '“' | '”' | '「' | '」'))
        .trim()
        .to_string()
}

/// 翻译 SRT 文件，保留时间戳与条目顺序，写出新的 SRT 文件。
///
/// `src_srt` - 源 SRT 文件路径
/// `dst_srt` - 目标路径，为空则在源文件旁生成 `<stem>.<lang>.srt`
/// `options` - 翻译选项
pub async fn translate_srt_file(
    src_srt: &Path,
    dst_srt: Option<&Path>,
    options: TranslateOptions,
) -> Result<PathBuf> {
    let content = tokio::fs::read_to_string(src_srt)
        .await
        .with_context(|| format!("读取 SRT 失败: {}", src_srt.display()))?;

    let mut entries = parse_srt(&content)?;
    if entries.is_empty() {
        anyhow::bail!("SRT 文件无有效条目: {}", src_srt.display());
    }

    let client = Arc::new(build_siliconflow_client()?);
    let total = entries.len();
    let model = options.model.clone();
    let lang = options.target_language.clone();
    let concurrency = options.concurrency.max(1);
    let batch_size = options.batch_size.max(1);

    // 跳过纯空白条目（无需送给模型）
    let work_items: Vec<(usize, String)> = entries
        .iter()
        .enumerate()
        .filter(|(_, e)| !e.text.trim().is_empty())
        .map(|(i, e)| (i, e.text.clone()))
        .collect();

    tracing::info!(
        "开始翻译 SRT: {} 条 (有效 {}) -> {} (model={}, batch_size={}, concurrency={})",
        total,
        work_items.len(),
        lang,
        model,
        batch_size,
        concurrency
    );

    let translated: Vec<(usize, Result<String>)> = if batch_size > 1 {
        run_batched(&client, &model, &lang, work_items, batch_size, concurrency).await
    } else {
        run_one_by_one(&client, &model, &lang, work_items, concurrency).await
    };

    let mut ok = 0usize;
    let mut fail = 0usize;
    for (i, res) in translated {
        match res {
            Ok(t) => {
                let cleaned = t.trim();
                if cleaned.is_empty() && !entries[i].text.trim().is_empty() {
                    fail += 1;
                    tracing::warn!("第 {} 条翻译返回空内容，保留原文", i + 1);
                    entries[i].text = format!("[未翻译] {}", entries[i].text.trim());
                } else {
                    entries[i].text = cleaned.to_string();
                    ok += 1;
                }
            }
            Err(e) => {
                fail += 1;
                tracing::warn!("第 {} 条翻译失败，保留原文: {:#}", i + 1, e);
                entries[i].text = format!("[未翻译] {}", entries[i].text.trim());
            }
        }
    }
    tracing::info!("翻译完成: 成功 {}, 失败 {}, 共 {}", ok, fail, total);

    let out = build_srt(&entries);
    let dst = match dst_srt {
        Some(p) => p.to_path_buf(),
        None => default_translated_path(src_srt, &lang),
    };
    tokio::fs::write(&dst, out)
        .await
        .with_context(|| format!("写出 SRT 失败: {}", dst.display()))?;

    Ok(dst)
}

/// 批量并发翻译；批级失败时自动回退该批为逐条翻译。
///
/// 每条字幕完成解析（包含批量与回退路径）后立刻通过 `tracing::info!` 打印
/// `[N/total] #idx  原文 → 译文`，方便长任务下实时观察进度。
async fn run_batched(
    client: &Arc<Client<OpenAIConfig>>,
    model: &str,
    target_language: &str,
    items: Vec<(usize, String)>,
    batch_size: usize,
    concurrency: usize,
) -> Vec<(usize, Result<String>)> {
    let total = items.len();
    let done = Arc::new(AtomicUsize::new(0));

    let batches: Vec<Vec<(usize, String)>> = items.chunks(batch_size).map(|c| c.to_vec()).collect();
    let total_batches = batches.len();

    stream::iter(batches.into_iter().enumerate().map(|(bi, batch)| {
        let client = client.clone();
        let model = model.to_string();
        let lang = target_language.to_string();
        let done = done.clone();
        async move {
            let segments: Vec<&str> = batch.iter().map(|(_, t)| t.as_str()).collect();
            match translate_batch(&client, &model, &lang, &segments).await {
                Ok(translations) => {
                    let mut results = Vec::with_capacity(batch.len());
                    for ((i, src), t) in batch.into_iter().zip(translations) {
                        let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                        log_translate_pair(n, total, i, &src, Ok(&t));
                        results.push((i, Ok(t)));
                    }
                    results
                }
                Err(e) => {
                    tracing::warn!(
                        "第 {}/{} 批翻译失败，回退到逐条翻译: {:#}",
                        bi + 1,
                        total_batches,
                        e
                    );
                    let mut results = Vec::with_capacity(batch.len());
                    for (i, text) in batch.into_iter() {
                        let res = translate_one(&client, &model, &lang, &text).await;
                        let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                        log_translate_pair(n, total, i, &text, res.as_deref());
                        results.push((i, res));
                    }
                    results
                }
            }
        }
    }))
    .buffer_unordered(concurrency)
    .flat_map(stream::iter)
    .collect()
    .await
}

/// 逐条并发翻译。每条完成后立即打印 `[N/total]` 进度。
async fn run_one_by_one(
    client: &Arc<Client<OpenAIConfig>>,
    model: &str,
    target_language: &str,
    items: Vec<(usize, String)>,
    concurrency: usize,
) -> Vec<(usize, Result<String>)> {
    let total = items.len();
    let done = Arc::new(AtomicUsize::new(0));

    stream::iter(items.into_iter().map(|(i, text)| {
        let client = client.clone();
        let model = model.to_string();
        let lang = target_language.to_string();
        let done = done.clone();
        async move {
            let res = translate_one(&client, &model, &lang, &text).await;
            let n = done.fetch_add(1, Ordering::Relaxed) + 1;
            log_translate_pair(n, total, i, &text, res.as_deref());
            (i, res)
        }
    }))
    .buffer_unordered(concurrency)
    .collect()
    .await
}

/// 打印一条字幕的翻译结果。`idx` 为 0-based 在原 SRT 中的下标，日志按 1-based 显示。
///
/// 为避免日志被超长字幕刷屏，单行截断到 [`LOG_TEXT_MAX_CHARS`] 字符并把内嵌换行替换为空格。
fn log_translate_pair(
    done: usize,
    total: usize,
    idx: usize,
    src: &str,
    res: Result<&str, &anyhow::Error>,
) {
    let src_clip = clip_for_log(src);
    match res {
        Ok(t) => {
            let dst_clip = clip_for_log(t);
            tracing::info!(
                "[翻译 {done}/{total}] #{nth}  {src_clip}  →  {dst_clip}",
                nth = idx + 1
            );
        }
        Err(e) => {
            tracing::warn!(
                "[翻译 {done}/{total}] #{nth} 失败  原文={src_clip}  | {e:#}",
                nth = idx + 1
            );
        }
    }
}

/// 翻译日志中单条字幕原文/译文的最大显示字符数（按 char 计数）
const LOG_TEXT_MAX_CHARS: usize = 80;

/// 把字幕文本压成单行并截断，仅用于日志输出。
fn clip_for_log(s: &str) -> String {
    let one_line = s.replace('\n', " ").replace('\r', " ");
    let trimmed = one_line.trim();
    let n = trimmed.chars().count();
    if n <= LOG_TEXT_MAX_CHARS {
        trimmed.to_string()
    } else {
        let head: String = trimmed.chars().take(LOG_TEXT_MAX_CHARS).collect();
        format!("{head}…")
    }
}

/// 已知会作为字幕文件后缀出现的语言代码集合
const KNOWN_LANG_CODES: &[&str] = &["zh", "en", "ja", "ko", "fr", "de", "es", "ru", "tr"];

/// 在源文件旁生成默认的输出路径：`<stem>.<lang>.srt`
///
/// 若源文件名已经带有已知的语言代码后缀（如 `xxx.en.srt`），会先剥离该后缀，
/// 避免叠加成 `xxx.en.zh.srt`。
fn default_translated_path(src: &Path, target_language: &str) -> PathBuf {
    let code = language_short_code(target_language);
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "subtitle".to_string());
    let base = strip_known_lang_suffix(&stem);
    let mut out = src.to_path_buf();
    out.set_file_name(format!("{base}.{code}.srt"));
    out
}

/// 如果 stem 以已知语言代码（以 `.` 分隔）结尾，则去掉该后缀。
fn strip_known_lang_suffix(stem: &str) -> &str {
    if let Some((head, tail)) = stem.rsplit_once('.') {
        if !head.is_empty()
            && KNOWN_LANG_CODES
                .iter()
                .any(|c| c.eq_ignore_ascii_case(tail))
        {
            return head;
        }
    }
    stem
}

/// 把目标语言名归一化为简短后缀
fn language_short_code(lang: &str) -> &'static str {
    match lang.trim().to_lowercase().as_str() {
        "chinese" | "zh" | "zh-cn" | "中文" | "简体中文" => "zh",
        "english" | "en" | "英文" | "英语" => "en",
        "japanese" | "ja" | "日文" | "日语" => "ja",
        "korean" | "ko" | "韩文" | "韩语" => "ko",
        "french" | "fr" | "法语" => "fr",
        "german" | "de" | "德语" => "de",
        "spanish" | "es" | "西班牙语" => "es",
        "russian" | "ru" | "俄语" => "ru",
        _ => "tr",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_max_tokens_clamped() {
        assert_eq!(estimate_max_tokens(""), 64);
        assert!(estimate_max_tokens(&"啊".repeat(2000)) <= 2048);
    }

    #[test]
    fn strip_prefix_basic() {
        assert_eq!(strip_translation_prefix("你好"), "你好");
        assert_eq!(strip_translation_prefix("Translation: 你好"), "你好");
        assert_eq!(strip_translation_prefix("翻译：你好"), "你好");
        assert_eq!(strip_translation_prefix("\"你好\""), "你好");
        assert_eq!(strip_translation_prefix("“你好”"), "你好");
    }

    #[test]
    fn parse_delimiter_recognizes_variants() {
        assert_eq!(parse_delimiter_line("<<<1>>>"), Some(1));
        assert_eq!(parse_delimiter_line("  <<<23>>>  "), Some(23));
        assert_eq!(parse_delimiter_line("<<< 7 >>>"), Some(7));
        assert_eq!(parse_delimiter_line("<<<#5>>>"), Some(5));
        assert_eq!(parse_delimiter_line("**<<<2>>>**"), Some(2));
        assert!(parse_delimiter_line("<<<abc>>>").is_none());
        assert!(parse_delimiter_line("<<<>>>").is_none());
        assert!(parse_delimiter_line("hello <<<1>>> world").is_none());
    }

    #[test]
    fn parse_batch_basic() {
        let resp = "<<<1>>>\n你好世界\n<<<2>>>\n你好吗？\n<<<3>>>\n再见\n";
        let got = parse_batch_response(resp, 3).unwrap();
        assert_eq!(got, vec!["你好世界", "你好吗？", "再见"]);
    }

    #[test]
    fn parse_batch_preserves_inner_newlines() {
        let resp = "<<<1>>>\n第一行\n第二行\n<<<2>>>\n第二条\n";
        let got = parse_batch_response(resp, 2).unwrap();
        assert_eq!(got, vec!["第一行\n第二行", "第二条"]);
    }

    #[test]
    fn parse_batch_ignores_preamble() {
        let resp = "Sure, here is the translation:\n<<<1>>>\n你好\n<<<2>>>\n世界\n";
        let got = parse_batch_response(resp, 2).unwrap();
        assert_eq!(got, vec!["你好", "世界"]);
    }

    #[test]
    fn parse_batch_missing_segment_errors() {
        let resp = "<<<1>>>\n你好\n<<<3>>>\n再见\n";
        let err = parse_batch_response(resp, 3).unwrap_err();
        assert!(err.to_string().contains("缺少第 2 条"));
    }

    #[test]
    fn parse_batch_empty_segment_errors() {
        let resp = "<<<1>>>\n你好\n<<<2>>>\n\n<<<3>>>\n再见\n";
        let err = parse_batch_response(resp, 3).unwrap_err();
        assert!(err.to_string().contains("第 2 条"));
    }

    #[test]
    fn build_batch_prompt_contains_all_segments() {
        let segs = vec!["Hello", "World"];
        let prompt = build_batch_prompt("Chinese", &segs);
        assert!(prompt.contains("<<<1>>>\nHello"));
        assert!(prompt.contains("<<<2>>>\nWorld"));
        assert!(prompt.contains("Chinese"));
    }

    #[test]
    fn strip_known_lang_suffix_strips_known() {
        assert_eq!(
            strip_known_lang_suffix("Anna & Collin - Carley Nubiles.en"),
            "Anna & Collin - Carley Nubiles"
        );
        assert_eq!(strip_known_lang_suffix("foo.ZH"), "foo");
    }

    #[test]
    fn strip_known_lang_suffix_keeps_unknown() {
        assert_eq!(strip_known_lang_suffix("foo.bar"), "foo.bar");
        assert_eq!(strip_known_lang_suffix("foo"), "foo");
        assert_eq!(strip_known_lang_suffix(".en"), ".en");
    }

    #[test]
    fn default_translated_path_replaces_lang_suffix() {
        let src = Path::new("/tmp/Anna & Collin - Carley Nubiles.en.srt");
        let out = default_translated_path(src, "Chinese");
        assert_eq!(
            out,
            PathBuf::from("/tmp/Anna & Collin - Carley Nubiles.zh.srt")
        );
    }

    #[test]
    fn default_translated_path_appends_when_no_lang_suffix() {
        let src = Path::new("/tmp/movie.srt");
        let out = default_translated_path(src, "Chinese");
        assert_eq!(out, PathBuf::from("/tmp/movie.zh.srt"));
    }
}
