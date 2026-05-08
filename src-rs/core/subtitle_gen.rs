use std::collections::HashMap;
use std::path::Path;

use anyhow::{ensure, Context, Result};

use crate::core::{
    ffmpeg::extract_wav_16k_mono,
    openai::{translate_srt_file, TranslateOptions},
    subtitle_file::write_srt_file,
    vad::{detect_vad_intervals_i16, VadConfig},
    whisper::{WhisperEngine, WhisperEngineConfig, WhisperOptions, WhisperTranscribeItem},
};

/// 字幕翻译配置：包装 [`TranslateOptions`] + 可选 API key。
///
/// 在 [`generate_subtitle_with`] 中传入 `Some(...)` 即可在生成原文 SRT 后
/// 自动调用 LLM 翻译，输出 `<stem>.<lang>.srt`。
///
/// `api_key` 为 `None` 时回退读取 `SILICONFLOW_API_KEY` 环境变量。
#[derive(Clone, Debug, Default)]
pub struct SubtitleTranslateConfig {
    /// 翻译参数（模型、目标语言、并发、批量大小）
    pub options: TranslateOptions,
    /// 可选 API key（明文）；为 `None` 时使用环境变量
    pub api_key: Option<String>,
    /// 是否在翻译完成后删除原文 SRT。默认 `false`，两份文件并存便于核对。
    pub remove_source_srt: bool,
}

const SAMPLE_RATE: usize = 16_000;

/// 将 16kHz 采样数转为百毫秒（cs，1cs = 10ms）
#[inline]
fn samples_to_cs(samples: usize) -> i64 {
    ((samples as i64).saturating_mul(100)) / (SAMPLE_RATE as i64)
}

/// 读取 16kHz / mono / 16-bit PCM WAV 文件，并校验格式
fn load_wav_i16_mono16k(path: &Path) -> Result<Vec<i16>> {
    let mut reader = hound::WavReader::open(path)
        .with_context(|| format!("打开 WAV 失败: {}", path.display()))?;
    let spec = reader.spec();
    ensure!(
        spec.sample_rate == 16_000,
        "WAV 采样率必须为 16kHz，当前 {} Hz",
        spec.sample_rate
    );
    ensure!(
        spec.channels == 1,
        "WAV 必须为单声道，当前 {} 声道",
        spec.channels
    );
    ensure!(
        spec.bits_per_sample == 16,
        "WAV 必须为 16-bit PCM，当前 {} bit",
        spec.bits_per_sample
    );
    ensure!(
        matches!(spec.sample_format, hound::SampleFormat::Int),
        "WAV 必须为 PCM 整型样本（pcm_s16le）"
    );
    reader
        .samples::<i16>()
        .collect::<Result<Vec<_>, _>>()
        .context("读取 WAV 样本失败")
}

/// 简单后处理：合并连续完全相同的 segment（whisper 残余幻觉重复）
fn dedupe_consecutive(items: Vec<WhisperTranscribeItem>) -> Vec<WhisperTranscribeItem> {
    let mut out: Vec<WhisperTranscribeItem> = Vec::with_capacity(items.len());
    for item in items {
        if let Some(last) = out.last_mut() {
            if last.text == item.text {
                last.end_cs = item.end_cs.max(last.end_cs);
                continue;
            }
        }
        out.push(item);
    }
    out
}

pub async fn generate_subtitle(video_path: &Path, vad_config: Option<VadConfig>) -> Result<String> {
    generate_subtitle_with(video_path, vad_config, None, None, None).await
}

/// 进阶入口：可自定义 whisper 引擎配置、解码参数和可选的 LLM 翻译。
///
/// `translate = Some(...)` 时，会在原文 SRT 写盘成功后调用 LLM 翻译，
/// 输出 `<stem>.<target_lang>.srt`，并返回翻译后的 SRT 路径。
/// 翻译失败不会中断流程，仅打印 warn 并退化返回原文 SRT 路径。
pub async fn generate_subtitle_with(
    video_path: &Path,
    vad_config: Option<VadConfig>,
    engine_cfg: Option<WhisperEngineConfig>,
    options: Option<WhisperOptions>,
    translate: Option<SubtitleTranslateConfig>,
) -> Result<String> {
    let wav_path = extract_wav_16k_mono(video_path)
        .await
        .with_context(|| format!("提取 WAV 失败: {}", video_path.display()))?;

    let samples_i16 = load_wav_i16_mono16k(&wav_path)?;
    tracing::info!(
        wav = %wav_path.display(),
        samples = samples_i16.len(),
        dur_s = samples_i16.len() as f64 / SAMPLE_RATE as f64,
        "[subtitle] 已加载 WAV"
    );

    let engine = match engine_cfg {
        Some(c) => WhisperEngine::with_config(c)?,
        None => WhisperEngine::new()?,
    };
    let options = options.unwrap_or_default();

    let mut all_segments: Vec<WhisperTranscribeItem> = Vec::new();
    // 多个 VAD 段可能各自被检测为不同语言，按"加权出现次数"聚合后取多数
    let mut lang_counts: HashMap<String, usize> = HashMap::new();
    let mut record_lang = |lang: Option<String>, weight: usize| {
        if let Some(l) = lang.filter(|s| !s.is_empty()) {
            *lang_counts.entry(l).or_default() += weight.max(1);
        }
    };

    match vad_config {
        Some(vad_config) => {
            let intervals = detect_vad_intervals_i16(&samples_i16, vad_config)?;

            if intervals.is_empty() {
                tracing::warn!("VAD 未检出语音段，回退为整段转写");
                let out = engine.transcribe(&samples_i16, 0, &options)?;
                record_lang(out.lang, out.items.len());
                all_segments.extend(out.items);
            } else {
                let total = intervals.len();
                tracing::info!("VAD 检出 {total} 个语音段");
                for (idx, (s, e)) in intervals.iter().enumerate() {
                    let offset_cs = samples_to_cs(*s);
                    let dur_cs = samples_to_cs(e.saturating_sub(*s));
                    tracing::info!(
                        "[VAD #{idx}/{total}] samples=[{s}, {e}) offset={offset_cs}cs dur={dur_cs}cs"
                    );
                    let out = engine
                        .transcribe(&samples_i16[*s..*e], offset_cs, &options)
                        .with_context(|| format!("VAD 段 #{idx} 解码失败"))?;
                    record_lang(out.lang, out.items.len());
                    all_segments.extend(out.items);
                }
            }
        }
        None => {
            let out = engine.transcribe(&samples_i16, 0, &options)?;
            record_lang(out.lang, out.items.len());
            all_segments.extend(out.items);
        }
    }

    // 排序 + 连续重复合并
    all_segments.sort_by_key(|s| s.start_cs);
    let before = all_segments.len();
    let all_segments = dedupe_consecutive(all_segments);
    if before != all_segments.len() {
        tracing::info!(
            "[subtitle] 合并连续重复段: {} → {}",
            before,
            all_segments.len()
        );
    }

    // 取出现频次最高的语言代码作为整段音频的语种
    let detected_lang = lang_counts
        .iter()
        .max_by_key(|(_, n)| *n)
        .map(|(k, _)| k.clone());
    if let Some(ref l) = detected_lang {
        tracing::info!("[subtitle] 识别到语种: {l} (各语种段数: {:?})", lang_counts);
    } else {
        tracing::warn!("[subtitle] 未能识别到语种，将不在 SRT 文件名上附加语言代码");
    }

    let srt_path = write_srt_file(video_path, None, &all_segments, detected_lang.as_deref())
        .with_context(|| format!("写入 SRT 失败: {}", video_path.display()))?;

    tracing::info!("[subtitle] 字幕生成完成: {}", srt_path.display());

    // 可选：翻译为目标语言
    if let Some(cfg) = translate {
        // 同语种短路：原文已经是目标语言，无需翻译
        if let Some(ref src) = detected_lang {
            if same_language(src, &cfg.options.target_language) {
                tracing::info!(
                    "[subtitle] 检测语种 {src} 与目标语种 {} 一致，跳过翻译",
                    cfg.options.target_language
                );
                return Ok(srt_path.display().to_string());
            }
        }

        if all_segments.is_empty() {
            tracing::info!("[subtitle] 无字幕条目，跳过翻译");
            return Ok(srt_path.display().to_string());
        }

        tracing::info!(
            "[subtitle] 开始翻译: {} -> {}",
            detected_lang.as_deref().unwrap_or("auto"),
            cfg.options.target_language
        );
        match translate_srt_file(&srt_path, None, cfg.options.clone(), cfg.api_key.as_deref()).await
        {
            Ok(translated) => {
                tracing::info!("[subtitle] 翻译完成: {}", translated.display());
                if cfg.remove_source_srt && translated != srt_path {
                    if let Err(e) = std::fs::remove_file(&srt_path) {
                        tracing::warn!(
                            "[subtitle] 删除原文 SRT 失败({}): {e:#}",
                            srt_path.display()
                        );
                    }
                }
                return Ok(translated.display().to_string());
            }
            Err(e) => {
                tracing::warn!("[subtitle] 翻译失败，保留原文 SRT: {e:#}");
            }
        }
    }

    Ok(srt_path.display().to_string())
}

/// 判断 whisper 检测到的源语种短代码与翻译目标语言名是否一致。
///
/// whisper 给出的是 ISO-639-1 短代码（"zh"/"en"/...），
/// 而 `TranslateOptions::target_language` 通常是 "Chinese"/"English"
/// 等英文名（也接受短代码 / 中文别名），这里做最常见映射的对齐。
fn same_language(src_short: &str, target: &str) -> bool {
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
