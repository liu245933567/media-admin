use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use async_openai::{
    Client,
    config::OpenAIConfig,
    error::OpenAIError,
    types::chat::{
        ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequest,
        CreateChatCompletionRequestArgs,
    },
};
use futures::stream::{self, StreamExt};
use ma_whisper::types::WhisperTranscribeItem;

use ma_utils::config::{get_translate_openai_api_key, get_translate_openai_base};

use crate::file::{SrtEntry, build_srt, parse_srt};
use crate::segment_filter::is_translatable_segment;
use crate::types::SubtitleTranslateConfig;

/// 单条翻译请求的最长等待时间（含网络 + 服务端推理）
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// 失败重试次数上限（不含首次请求）
const MAX_RETRIES: u32 = 3;

/// 重试初始退避时间，每次失败翻倍，封顶 8 秒
const RETRY_INITIAL_DELAY: Duration = Duration::from_millis(800);
const RETRY_MAX_DELAY: Duration = Duration::from_secs(8);

/// 单次批量请求的 max_tokens 上限
const BATCH_MAX_TOKENS_CAP: u32 = 4096;

/// 批量 prompt 中分隔符的前后缀，遇到 `<<<N>>>` 行视为新段开始
const BATCH_DELIM_PREFIX: &str = "<<<";
const BATCH_DELIM_SUFFIX: &str = ">>>";

/// 若命中则说明应立刻结束整条翻译任务（不再逐条重试、不写「部分未翻译」结果）。
const TRANSLATE_TASK_FATAL_MARKER: &str = "[translate-task-abort]";

/// 翻译日志中单条字幕原文/译文的最大显示字符数（按 char 计数）
const LOG_TEXT_MAX_CHARS: usize = 80;

/// 已知会作为字幕文件后缀出现的语言代码集合
const KNOWN_LANG_CODES: &[&str] = &["zh", "en", "ja", "ko", "fr", "de", "es", "ru", "tr"];

/// OpenAI 兼容翻译客户端与模型配置
#[derive(Clone)]
struct TranslateCtx {
    client: Arc<Client<OpenAIConfig>>,
    model: String,
    target_language: String,
}

impl TranslateCtx {
    fn new(options: &SubtitleTranslateConfig) -> Result<Self> {
        Ok(Self {
            client: Arc::new(build_translate_openai_client(options)?),
            model: options.model.clone(),
            target_language: options.target_language.clone(),
        })
    }

    async fn translate_segments(&self, segments: &[&str]) -> Result<Vec<String>> {
        chat_translate_with_retry(&self.client, &self.model, &self.target_language, segments).await
    }
}

/// 解析本次翻译使用的 API 基址与密钥：`options` 中非空字段优先，否则读环境变量。
fn resolve_translate_credentials(options: &SubtitleTranslateConfig) -> Result<(String, String)> {
    let base = {
        let t = options.base_url.trim();
        if t.is_empty() {
            get_translate_openai_base()?
        } else {
            t.to_string()
        }
    };
    let key = {
        let t = options.api_key.trim();
        if t.is_empty() {
            get_translate_openai_api_key()?
        } else {
            t.to_string()
        }
    };
    Ok((base, key))
}

/// 创建 OpenAI 兼容客户端（硅基流动等），凭据来自任务配置或环境变量。
fn build_translate_openai_client(
    options: &SubtitleTranslateConfig,
) -> Result<Client<OpenAIConfig>> {
    let (base, key) = resolve_translate_credentials(options)?;
    tracing::info!("构建翻译 OpenAI 客户端: base={base}");

    let config = OpenAIConfig::new().with_api_base(base).with_api_key(key);
    let http = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .context("构建 HTTP 客户端失败")?;

    Ok(Client::with_config(config).with_http_client(http))
}

fn estimate_max_tokens(text: &str) -> u32 {
    let n = text.chars().count() as u32;
    n.saturating_mul(3).saturating_add(64).clamp(64, 2048)
}

fn estimate_batch_max_tokens(segments: &[&str]) -> u32 {
    let total_chars: usize = segments.iter().map(|s| s.chars().count()).sum();
    let delim_overhead = (segments.len() as u32).saturating_mul(8);
    let estimated = (total_chars as u32)
        .saturating_mul(3)
        .saturating_add(delim_overhead)
        .saturating_add(128);
    estimated.clamp(128, BATCH_MAX_TOKENS_CAP)
}

fn build_translate_request(
    model: &str,
    target_language: &str,
    text: &str,
) -> Result<CreateChatCompletionRequest> {
    let prompt = format!(
        "Translate the following segment into {target_language}, without additional explanation.\n\n{text}"
    );
    build_chat_request(model, prompt, estimate_max_tokens(text))
}

fn build_batch_request(
    model: &str,
    target_language: &str,
    segments: &[&str],
) -> Result<CreateChatCompletionRequest> {
    let prompt = build_batch_prompt(target_language, segments);
    build_chat_request(model, prompt, estimate_batch_max_tokens(segments))
}

fn build_chat_request(
    model: &str,
    prompt: String,
    max_tokens: u32,
) -> Result<CreateChatCompletionRequest> {
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

fn openai_error_should_abort_whole_task(err: &OpenAIError) -> bool {
    match err {
        OpenAIError::JSONDeserialize(_, body) => {
            let b = body.to_ascii_lowercase();
            b.contains("api key is invalid")
                || b.contains("invalid api key")
                || b.contains("incorrect api key")
                || b.contains("unauthorized")
                || b.contains("authentication")
                || b.contains("invalid token")
                || b.contains("access denied")
        }
        OpenAIError::ApiError(api) => {
            let m = api.message.to_ascii_lowercase();
            let code = api.code.as_deref().unwrap_or("").to_ascii_lowercase();
            m.contains("api key") && (m.contains("invalid") || m.contains("incorrect"))
                || m.contains("unauthorized")
                || m.contains("invalid_api_key")
                || m.contains("incorrect api key")
                || code == "invalid_api_key"
                || code == "unauthorized"
        }
        _ => false,
    }
}

fn map_openai_translate_err(e: OpenAIError) -> anyhow::Error {
    if openai_error_should_abort_whole_task(&e) {
        anyhow!("{TRANSLATE_TASK_FATAL_MARKER} 翻译 API 鉴权失败或密钥无效，已中止任务: {e:#}")
    } else {
        anyhow::Error::from(e)
    }
}

pub fn is_fatal_translate_err(e: &anyhow::Error) -> bool {
    format!("{e:#}").contains(TRANSLATE_TASK_FATAL_MARKER)
}

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

/// 调用模型翻译若干段文本（单段走单条 prompt，多段走批量 prompt；含退避重试）。
async fn chat_translate_with_retry(
    client: &Client<OpenAIConfig>,
    model: &str,
    target_language: &str,
    segments: &[&str],
) -> Result<Vec<String>> {
    if segments.is_empty() {
        return Ok(Vec::new());
    }

    let single = segments.len() == 1;
    let mut delay = RETRY_INITIAL_DELAY;
    let mut last_parse_err: Option<anyhow::Error> = None;

    for attempt in 0..=MAX_RETRIES {
        let req = if single {
            build_translate_request(model, target_language, segments[0])?
        } else {
            build_batch_request(model, target_language, segments)?
        };

        match client.chat().create(req).await {
            Ok(resp) => {
                let content = resp
                    .choices
                    .into_iter()
                    .next()
                    .and_then(|c| c.message.content)
                    .ok_or_else(|| anyhow!("模型未返回翻译内容"))?;

                let parsed = if single {
                    Ok(vec![strip_translation_prefix(content.trim())])
                } else {
                    parse_batch_response(&content, segments.len()).map(|translations| {
                        translations
                            .into_iter()
                            .map(|t| strip_translation_prefix(&t))
                            .collect()
                    })
                };

                match parsed {
                    Ok(translations) => return Ok(translations),
                    Err(e) => {
                        last_parse_err = Some(e);
                        if attempt < MAX_RETRIES {
                            tracing::debug!(
                                "翻译解析失败 {}/{}（退避 {:?}）: {:#}",
                                attempt + 1,
                                MAX_RETRIES,
                                delay,
                                last_parse_err.as_ref().unwrap()
                            );
                            tokio::time::sleep(delay).await;
                            delay = (delay * 2).min(RETRY_MAX_DELAY);
                        }
                    }
                }
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
                return Err(map_openai_translate_err(e));
            }
        }
    }

    Err(last_parse_err.unwrap_or_else(|| anyhow!("翻译失败但未捕获错误")))
}

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

/// 在内存中翻译 Whisper 识别条目（保留时间戳，仅替换 `text`）。
pub async fn translate_whisper_items(
    items: &mut [WhisperTranscribeItem],
    options: &SubtitleTranslateConfig,
) -> Result<()> {
    if items.is_empty() {
        return Ok(());
    }

    let ctx = TranslateCtx::new(options)?;
    let batch_size = options.batch_size.max(1) as usize;
    let concurrency = options.concurrency.max(1) as usize;

    let work_items: Vec<(usize, String)> = items
        .iter()
        .enumerate()
        .filter(|(_, e)| is_translatable_segment(e))
        .map(|(i, e)| (i, e.text.clone()))
        .collect();

    if work_items.is_empty() {
        return Ok(());
    }

    tracing::info!(
        "开始翻译识别条目: {} 条 (待译 {}) -> {} (model={}, batch_size={}, concurrency={})",
        items.len(),
        work_items.len(),
        ctx.target_language,
        ctx.model,
        batch_size,
        concurrency
    );

    let translated = run_translate_work(&ctx, work_items, batch_size, concurrency).await?;
    let (ok, fail) = apply_whisper_translation_results(items, translated)?;
    tracing::info!("识别条目翻译完成: 成功 {}, 失败 {}", ok, fail);
    Ok(())
}

/// 将翻译结果写回 [`WhisperTranscribeItem`] 列表。
fn apply_whisper_translation_results(
    items: &mut [WhisperTranscribeItem],
    translated: Vec<(usize, Result<String>)>,
) -> Result<(usize, usize)> {
    let mut ok = 0usize;
    let mut fail = 0usize;

    for (i, res) in translated {
        match res {
            Ok(t) => {
                let cleaned = t.trim();
                if cleaned.is_empty() && !items[i].text.trim().is_empty() {
                    fail += 1;
                    tracing::warn!("第 {} 条翻译返回空内容，保留原文", i + 1);
                    items[i].text = format!("[未翻译] {}", items[i].text.trim());
                } else {
                    items[i].text = cleaned.to_string();
                    ok += 1;
                }
            }
            Err(e) => {
                if is_fatal_translate_err(&e) {
                    return Err(e).context(format!("字幕翻译在第 {} 条处中止", i + 1));
                }
                fail += 1;
                tracing::warn!("第 {} 条翻译失败，保留原文: {:#}", i + 1, e);
                items[i].text = format!("[未翻译] {}", items[i].text.trim());
            }
        }
    }

    Ok((ok, fail))
}

/// 翻译 SRT 文件，保留时间戳与条目顺序，写出新的 SRT 文件。
pub async fn translate_srt_file(
    src_srt: &Path,
    dst_srt: Option<&Path>,
    options: &SubtitleTranslateConfig,
) -> Result<PathBuf> {
    translate_srt_file_incremental(src_srt, dst_srt, options, |_| Ok(())).await
}

/// 翻译 SRT 文件，并在每批翻译结果写回内存条目后回调当前完整字幕列表。
pub async fn translate_srt_file_incremental<F>(
    src_srt: &Path,
    dst_srt: Option<&Path>,
    options: &SubtitleTranslateConfig,
    mut on_update: F,
) -> Result<PathBuf>
where
    F: FnMut(&[WhisperTranscribeItem]) -> Result<()>,
{
    let content = tokio::fs::read_to_string(src_srt)
        .await
        .with_context(|| format!("读取 SRT 失败: {}", src_srt.display()))?;

    let mut entries = parse_srt(&content)?;
    if entries.is_empty() {
        anyhow::bail!("SRT 文件无有效条目: {}", src_srt.display());
    }

    let ctx = TranslateCtx::new(options)?;
    let lang = ctx.target_language.clone();
    let batch_size = options.batch_size.max(1) as usize;
    let concurrency = options.concurrency.max(1) as usize;

    let work_items: Vec<(usize, String)> = entries
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            let dur_cs = 100i64;
            !e.text.trim().is_empty()
                && !crate::segment_filter::is_meaningless_segment(&e.text, dur_cs)
        })
        .map(|(i, e)| (i, e.text.clone()))
        .collect();

    tracing::info!(
        "开始翻译 SRT: {} 条 (有效 {}) -> {} (model={}, batch_size={}, concurrency={})",
        entries.len(),
        work_items.len(),
        lang,
        ctx.model,
        batch_size,
        concurrency
    );

    let translated = run_translate_work(&ctx, work_items, batch_size, concurrency).await?;
    let total_translated = translated.len();
    let mut ok = 0usize;
    let mut fail = 0usize;
    let mut pending_batch = Vec::with_capacity(batch_size.max(1));
    for item in translated {
        pending_batch.push(item);
        if pending_batch.len() < batch_size.max(1) {
            continue;
        }
        let (chunk_ok, chunk_fail) =
            apply_translation_results(&mut entries, std::mem::take(&mut pending_batch))?;
        ok += chunk_ok;
        fail += chunk_fail;
        on_update(&srt_entries_to_whisper_items(&entries))?;
    }
    if !pending_batch.is_empty() {
        let (chunk_ok, chunk_fail) = apply_translation_results(&mut entries, pending_batch)?;
        ok += chunk_ok;
        fail += chunk_fail;
        on_update(&srt_entries_to_whisper_items(&entries))?;
    } else if total_translated == 0 {
        on_update(&srt_entries_to_whisper_items(&entries))?;
    }
    tracing::info!("翻译完成: 成功 {}, 失败 {}, 共 {}", ok, fail, entries.len());

    let dst = match dst_srt {
        Some(p) => p.to_path_buf(),
        None => default_translated_path(src_srt, &lang),
    };
    tokio::fs::write(&dst, build_srt(&entries))
        .await
        .with_context(|| format!("写出 SRT 失败: {}", dst.display()))?;

    if options.remove_source_srt {
        tokio::fs::remove_file(src_srt)
            .await
            .with_context(|| format!("删除源 SRT 失败: {}", src_srt.display()))?;
    }

    Ok(dst)
}

fn parse_srt_time_cs(value: &str) -> Option<i64> {
    let value = value.trim().replace(',', ".");
    let mut parts = value.split(':');
    let hours = parts.next()?.trim().parse::<i64>().ok()?;
    let minutes = parts.next()?.trim().parse::<i64>().ok()?;
    let seconds_part = parts.next()?.trim();
    if parts.next().is_some() {
        return None;
    }
    let mut sec_parts = seconds_part.split('.');
    let seconds = sec_parts.next()?.trim().parse::<i64>().ok()?;
    let frac = sec_parts.next().unwrap_or("0").trim();
    let millis = match frac.len() {
        0 => 0,
        1 => frac.parse::<i64>().ok()?.saturating_mul(100),
        2 => frac.parse::<i64>().ok()?.saturating_mul(10),
        _ => frac.get(..3)?.parse::<i64>().ok()?,
    };
    Some(
        hours
            .saturating_mul(360_000)
            .saturating_add(minutes.saturating_mul(6_000))
            .saturating_add(seconds.saturating_mul(100))
            .saturating_add(millis / 10),
    )
}

fn parse_srt_time_line_cs(time_line: &str) -> (i64, i64) {
    let mut parts = time_line.split("-->");
    let start = parts.next().and_then(parse_srt_time_cs).unwrap_or_default();
    let end = parts
        .next()
        .and_then(parse_srt_time_cs)
        .unwrap_or_else(|| start.saturating_add(1));
    (start, end.max(start.saturating_add(1)))
}

fn srt_entries_to_whisper_items(entries: &[SrtEntry]) -> Vec<WhisperTranscribeItem> {
    entries
        .iter()
        .map(|entry| {
            let (start_cs, end_cs) = parse_srt_time_line_cs(&entry.time_line);
            WhisperTranscribeItem {
                start_cs,
                end_cs,
                text: entry.text.trim().to_string(),
            }
        })
        .collect()
}

/// 与识别并行：收到 `notify` 时扫描新增条目并提交翻译，结果写回 `segments` 的 `text`。
pub async fn overlap_translate_whisper_segments(
    segments: Arc<Mutex<Vec<WhisperTranscribeItem>>>,
    mut notify: tokio::sync::mpsc::UnboundedReceiver<()>,
    options: SubtitleTranslateConfig,
) -> Result<()> {
    let ctx = TranslateCtx::new(&options)?;
    let batch_size = options.batch_size.max(1) as usize;
    let concurrency = options.concurrency.max(1) as usize;
    let mut scheduled_until = 0usize;
    let mut in_flight: futures::stream::FuturesUnordered<
        tokio::task::JoinHandle<Result<Vec<(usize, Result<String>)>>>,
    > = futures::stream::FuturesUnordered::new();

    loop {
        tokio::select! {
            msg = notify.recv() => {
                if msg.is_none() {
                    break;
                }
                while notify.try_recv().is_ok() {}
            }
            Some(join_res) = in_flight.next(), if !in_flight.is_empty() => {
                let batch_results = join_res.context("翻译批任务 join 失败")??;
                let mut segs = segments.lock().expect("segments lock");
                apply_whisper_translation_results(&mut segs, batch_results)?;
            }
            else => {
                tokio::task::yield_now().await;
            }
        }
        schedule_overlap_batches(
            &segments,
            &mut scheduled_until,
            &ctx,
            batch_size,
            concurrency,
            &mut in_flight,
            true,
        )?;
    }

    finish_overlap_translation(
        &segments,
        &mut scheduled_until,
        &ctx,
        batch_size,
        concurrency,
        &mut in_flight,
    )
    .await?;

    Ok(())
}

/// 识别结束后：循环「入队 → 等待全部完成」直至无待译条目，避免长视频后半段漏翻。
async fn finish_overlap_translation(
    segments: &Arc<Mutex<Vec<WhisperTranscribeItem>>>,
    scheduled_until: &mut usize,
    ctx: &TranslateCtx,
    batch_size: usize,
    concurrency: usize,
    in_flight: &mut futures::stream::FuturesUnordered<
        tokio::task::JoinHandle<Result<Vec<(usize, Result<String>)>>>,
    >,
) -> Result<()> {
    loop {
        schedule_overlap_batches(
            segments,
            scheduled_until,
            ctx,
            batch_size,
            concurrency,
            in_flight,
            false,
        )?;

        while let Some(join_res) = in_flight.next().await {
            let batch_results = join_res.context("翻译批任务 join 失败")??;
            let mut segs = segments.lock().expect("segments lock");
            apply_whisper_translation_results(&mut segs, batch_results)?;
        }

        if collect_whisper_translate_work(segments, *scheduled_until).is_empty() {
            break;
        }
    }

    Ok(())
}

/// `require_full_batch` 为 true 时仅当待译条数 ≥ `batch_size` 才提交（识别过程中）；收尾阶段提交全部剩余。
fn schedule_overlap_batches(
    segments: &Arc<Mutex<Vec<WhisperTranscribeItem>>>,
    scheduled_until: &mut usize,
    ctx: &TranslateCtx,
    batch_size: usize,
    concurrency: usize,
    in_flight: &mut futures::stream::FuturesUnordered<
        tokio::task::JoinHandle<Result<Vec<(usize, Result<String>)>>>,
    >,
    require_full_batch: bool,
) -> Result<()> {
    let work = collect_whisper_translate_work(segments, *scheduled_until);
    if work.is_empty() {
        return Ok(());
    }
    if require_full_batch && work.len() < batch_size {
        return Ok(());
    }

    let total = work.len();
    let batches: Vec<Vec<(usize, String)>> = work.chunks(batch_size).map(|c| c.to_vec()).collect();
    let done = Arc::new(AtomicUsize::new(0));
    let total_batches = batches.len();
    let mut last_scheduled_idx: Option<usize> = None;

    for (bi, batch) in batches.into_iter().enumerate() {
        if in_flight.len() >= concurrency {
            break;
        }
        if let Some((idx, _)) = batch.last() {
            last_scheduled_idx = Some(*idx);
        }
        let ctx = ctx.clone();
        let done = done.clone();
        in_flight.push(tokio::spawn(async move {
            process_translate_batch(&ctx, bi, total_batches, batch, &done, total).await
        }));
    }

    if let Some(idx) = last_scheduled_idx {
        *scheduled_until = idx + 1;
    }
    Ok(())
}

fn collect_whisper_translate_work(
    segments: &Arc<Mutex<Vec<WhisperTranscribeItem>>>,
    scheduled_until: usize,
) -> Vec<(usize, String)> {
    let segs = segments.lock().expect("segments lock");
    let mut work = Vec::new();
    for i in scheduled_until..segs.len() {
        if is_translatable_segment(&segs[i]) {
            work.push((i, segs[i].text.clone()));
        }
    }
    work
}

/// 并发翻译字幕条目；按 `batch_size` 分块，批失败时回退为逐条翻译。
async fn run_translate_work(
    ctx: &TranslateCtx,
    items: Vec<(usize, String)>,
    batch_size: usize,
    concurrency: usize,
) -> Result<Vec<(usize, Result<String>)>> {
    let total = items.len();
    let done = Arc::new(AtomicUsize::new(0));
    let batches: Vec<Vec<(usize, String)>> = items.chunks(batch_size).map(|c| c.to_vec()).collect();
    let total_batches = batches.len();

    let per_batch: Vec<Result<Vec<(usize, Result<String>)>>> =
        stream::iter(batches.into_iter().enumerate().map(|(bi, batch)| {
            let ctx = ctx;
            let done = done.clone();
            async move {
                process_translate_batch(ctx, bi, total_batches, batch, &done, total).await
            }
        }))
        .buffer_unordered(concurrency)
        .collect()
        .await;

    let mut out = Vec::new();
    for br in per_batch {
        out.extend(br?);
    }
    Ok(out)
}

/// 处理一批字幕：单条直接翻译，多条批量翻译并在失败时回退逐条。
async fn process_translate_batch(
    ctx: &TranslateCtx,
    batch_index: usize,
    total_batches: usize,
    batch: Vec<(usize, String)>,
    done: &Arc<AtomicUsize>,
    total_items: usize,
) -> Result<Vec<(usize, Result<String>)>> {
    if batch.len() == 1 {
        let (i, text) = batch.into_iter().next().expect("len checked");
        let res = ctx
            .translate_segments(&[&text])
            .await
            .and_then(|mut v| v.pop().ok_or_else(|| anyhow!("模型未返回翻译内容")));
        if let Err(ref e) = res {
            if is_fatal_translate_err(e) {
                return Err(anyhow::anyhow!("{e:#}"));
            }
        }
        let n = done.fetch_add(1, Ordering::Relaxed) + 1;
        log_translate_pair(n, total_items, i, &text, res.as_deref());
        return Ok(vec![(i, res)]);
    }

    let segments: Vec<&str> = batch.iter().map(|(_, t)| t.as_str()).collect();
    match ctx.translate_segments(&segments).await {
        Ok(translations) => {
            let mut results = Vec::with_capacity(batch.len());
            for ((i, src), t) in batch.into_iter().zip(translations) {
                let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                log_translate_pair(n, total_items, i, &src, Ok(&t));
                results.push((i, Ok(t)));
            }
            Ok(results)
        }
        Err(e) => {
            if is_fatal_translate_err(&e) {
                tracing::error!(
                    "第 {}/{} 批翻译因鉴权等原因中止: {:#}",
                    batch_index + 1,
                    total_batches,
                    e
                );
                return Err(e);
            }
            tracing::warn!(
                "第 {}/{} 批翻译失败，回退到逐条翻译: {:#}",
                batch_index + 1,
                total_batches,
                e
            );
            let mut results = Vec::with_capacity(batch.len());
            for (i, text) in batch {
                let res = ctx
                    .translate_segments(&[&text])
                    .await
                    .and_then(|mut v| v.pop().ok_or_else(|| anyhow!("模型未返回翻译内容")));
                if let Err(ref re) = res {
                    if is_fatal_translate_err(re) {
                        return Err(anyhow::anyhow!("{re:#}"));
                    }
                }
                let n = done.fetch_add(1, Ordering::Relaxed) + 1;
                log_translate_pair(n, total_items, i, &text, res.as_deref());
                results.push((i, res));
            }
            Ok(results)
        }
    }
}

/// 将翻译结果写回条目，返回 (成功数, 失败数)。
fn apply_translation_results(
    entries: &mut [SrtEntry],
    translated: Vec<(usize, Result<String>)>,
) -> Result<(usize, usize)> {
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
                if is_fatal_translate_err(&e) {
                    return Err(e).context(format!("字幕翻译在第 {} 条处中止", i + 1));
                }
                fail += 1;
                tracing::warn!("第 {} 条翻译失败，保留原文: {:#}", i + 1, e);
                entries[i].text = format!("[未翻译] {}", entries[i].text.trim());
            }
        }
    }

    Ok((ok, fail))
}

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

/// 根据源 SRT 路径与目标语言计算译文 SRT 路径。
pub fn default_translated_path(src: &Path, target_language: &str) -> PathBuf {
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
