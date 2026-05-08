use std::path::{Path, PathBuf};
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use async_openai::{
    config::OpenAIConfig,
    types::chat::{ChatCompletionRequestUserMessageArgs, CreateChatCompletionRequestArgs},
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

/// 翻译选项
#[derive(Clone, Debug)]
pub struct TranslateOptions {
    /// 模型名，默认 `tencent/Hunyuan-MT-7B`
    pub model: String,
    /// 目标语言，例如 "Chinese"、"English"、"Japanese"
    pub target_language: String,
    /// 并发数
    pub concurrency: usize,
}

impl Default for TranslateOptions {
    fn default() -> Self {
        Self {
            model: HUNYUAN_MT_MODEL.to_string(),
            target_language: "Chinese".to_string(),
            concurrency: DEFAULT_CONCURRENCY,
        }
    }
}

/// 创建一个连接到硅基流动的 OpenAI 兼容客户端。
///
/// API key 优先使用入参，其次读取环境变量 `SILICONFLOW_API_KEY`。
pub fn build_siliconflow_client(api_key: Option<&str>) -> Result<Client<OpenAIConfig>> {
    let key = match api_key {
        Some(k) if !k.trim().is_empty() => k.to_string(),
        _ => std::env::var("SILICONFLOW_API_KEY")
            .map_err(|_| anyhow!("缺少环境变量 SILICONFLOW_API_KEY"))?,
    };
    let config = OpenAIConfig::new()
        .with_api_base(SILICONFLOW_API_BASE)
        .with_api_key(key);
    Ok(Client::with_config(config))
}

/// 调用 Hunyuan-MT 模型翻译一段文本到目标语言。
///
/// 按腾讯官方推荐 prompt 格式构造 user message。
async fn translate_text(
    client: &Client<OpenAIConfig>,
    model: &str,
    target_language: &str,
    text: &str,
) -> Result<String> {
    let prompt = format!(
        "Translate the following segment into {target_language}, without additional explanation.\n\n{text}"
    );

    let user_msg = ChatCompletionRequestUserMessageArgs::default()
        .content(prompt)
        .build()?;

    let req = CreateChatCompletionRequestArgs::default()
        .model(model)
        .messages(vec![user_msg.into()])
        .temperature(0.0)
        .build()?;

    let resp = client.chat().create(req).await?;
    let content = resp
        .choices
        .into_iter()
        .next()
        .and_then(|c| c.message.content)
        .ok_or_else(|| anyhow!("模型未返回翻译内容"))?;

    Ok(content.trim().to_string())
}

/// 翻译 SRT 文件，保留时间戳与条目顺序，写出新的 SRT 文件。
///
/// `src_srt` - 源 SRT 文件路径
/// `dst_srt` - 目标路径，为空则在源文件旁生成 `<stem>.<lang>.srt`
/// `options` - 翻译选项
/// `api_key` - 硅基流动 API key，为空则读取 `SILICONFLOW_API_KEY` 环境变量
pub async fn translate_srt_file(
    src_srt: &Path,
    dst_srt: Option<&Path>,
    options: TranslateOptions,
    api_key: Option<&str>,
) -> Result<PathBuf> {
    let content = tokio::fs::read_to_string(src_srt)
        .await
        .with_context(|| format!("读取 SRT 失败: {}", src_srt.display()))?;

    let mut entries = parse_srt(&content)?;
    if entries.is_empty() {
        anyhow::bail!("SRT 文件无有效条目: {}", src_srt.display());
    }

    let client = Arc::new(build_siliconflow_client(api_key)?);
    let total = entries.len();
    let model = Arc::new(options.model.clone());
    let lang = Arc::new(options.target_language.clone());
    let concurrency = options.concurrency.max(1);

    tracing::info!(
        "开始翻译 SRT: {} 条 -> {} (model={}, concurrency={})",
        total,
        options.target_language,
        options.model,
        concurrency
    );

    let texts: Vec<(usize, String)> = entries
        .iter()
        .enumerate()
        .map(|(i, e)| (i, e.text.clone()))
        .collect();

    let translated: Vec<(usize, Result<String>)> =
        stream::iter(texts.into_iter().map(|(i, text)| {
            let client = client.clone();
            let model = model.clone();
            let lang = lang.clone();
            async move {
                if text.trim().is_empty() {
                    return (i, Ok(text));
                }
                let res = translate_text(&client, &model, &lang, &text).await;
                (i, res)
            }
        }))
        .buffer_unordered(concurrency)
        .collect()
        .await;

    let mut ok = 0usize;
    let mut fail = 0usize;
    for (i, res) in translated {
        match res {
            Ok(t) => {
                entries[i].text = t;
                ok += 1;
            }
            Err(e) => {
                fail += 1;
                tracing::warn!("第 {} 条翻译失败，保留原文: {:#}", i + 1, e);
            }
        }
    }
    tracing::info!("翻译完成: 成功 {}, 失败 {}, 共 {}", ok, fail, total);

    let out = build_srt(&entries);
    let dst = match dst_srt {
        Some(p) => p.to_path_buf(),
        None => default_translated_path(src_srt, &options.target_language),
    };
    tokio::fs::write(&dst, out)
        .await
        .with_context(|| format!("写出 SRT 失败: {}", dst.display()))?;

    Ok(dst)
}

/// 在源文件旁生成默认的输出路径：`<stem>.<lang>.srt`
fn default_translated_path(src: &Path, target_language: &str) -> PathBuf {
    let code = language_short_code(target_language);
    let stem = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "subtitle".to_string());
    let mut out = src.to_path_buf();
    out.set_file_name(format!("{stem}.{code}.srt"));
    out
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
