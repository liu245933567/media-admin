use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result, ensure};
use tokio::task::spawn_blocking;

use crate::{
    engine_cache::acquire_shared_engine,
    types::{
        VadConfig, WhisperEngineConfig, WhisperTranscribeItem, WhisperTranscribeConfig,
        WhisperTranscribeOutput,
    },
    vad::detect_vad_intervals_i16,
    wav::extract_pcm_i16_mono16k,
};

const SAMPLE_RATE: usize = 16_000;

/// 将 16kHz 采样数转为百毫秒（cs，1cs = 10ms）
#[inline]
pub fn samples_to_cs(samples: usize) -> i64 {
    ((samples as i64).saturating_mul(100)) / (SAMPLE_RATE as i64)
}

/// 读取 16kHz / mono / 16-bit PCM WAV 文件，并校验格式
pub fn load_wav_i16_mono16k(path: &Path) -> Result<Vec<i16>> {
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
pub fn dedupe_consecutive(items: Vec<WhisperTranscribeItem>) -> Vec<WhisperTranscribeItem> {
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

fn finalize_segments(
    mut all_segments: Vec<WhisperTranscribeItem>,
    lang_counts: HashMap<String, usize>,
) -> WhisperTranscribeOutput {
    all_segments.sort_by_key(|s| s.start_cs);
    let before = all_segments.len();
    let all_segments = dedupe_consecutive(all_segments);
    if before != all_segments.len() {
        tracing::info!(
            "[whisper] 合并连续重复段: {} → {}",
            before,
            all_segments.len()
        );
    }

    let detected_lang = lang_counts
        .iter()
        .max_by_key(|(_, n)| *n)
        .map(|(k, _)| k.clone());
    if let Some(ref l) = detected_lang {
        tracing::info!("[whisper] 识别到语种: {l} (各语种段数: {:?})", lang_counts);
    } else {
        tracing::warn!("[whisper] 未能识别到语种");
    }

    WhisperTranscribeOutput {
        items: all_segments,
        lang: detected_lang,
    }
}

/// 对已加载的 16kHz mono PCM 做 VAD 切分 + Whisper 识别。
pub fn recognize_pcm_i16(
    samples_i16: &[i16],
    vad_config: Option<VadConfig>,
    whisper_engine_config: Option<WhisperEngineConfig>,
    whisper_transcribe_config: Option<WhisperTranscribeConfig>,
) -> Result<WhisperTranscribeOutput> {
    recognize_pcm_i16_incremental(
        samples_i16,
        vad_config,
        whisper_engine_config,
        whisper_transcribe_config,
        |_, _, _| Ok(()),
    )
}

/// 增量识别：每完成一个 VAD 区间（或整段回退）后调用 `on_interval`。
///
/// `on_interval` 参数：`(本区间条目, 区间序号从 0 起, 区间总数)`。
pub fn recognize_pcm_i16_incremental<F>(
    samples_i16: &[i16],
    vad_config: Option<VadConfig>,
    whisper_engine_config: Option<WhisperEngineConfig>,
    whisper_transcribe_config: Option<WhisperTranscribeConfig>,
    mut on_interval: F,
) -> Result<WhisperTranscribeOutput>
where
    F: FnMut(&[WhisperTranscribeItem], usize, usize) -> Result<()>,
{
    tracing::info!(
        samples = samples_i16.len(),
        dur_s = samples_i16.len() as f64 / SAMPLE_RATE as f64,
        "[whisper] 开始 PCM 识别"
    );

    let engine = acquire_shared_engine(whisper_engine_config)?;
    let engine = engine
        .lock()
        .map_err(|e| anyhow::anyhow!("whisper 引擎 lock: {e}"))?;
    let options = whisper_transcribe_config.unwrap_or_default();
    let vad_config = vad_config.unwrap_or_default();

    let mut all_segments: Vec<WhisperTranscribeItem> = Vec::new();
    let mut lang_counts: HashMap<String, usize> = HashMap::new();
    let mut record_lang = |lang: Option<String>, weight: usize| {
        if let Some(l) = lang.filter(|s| !s.is_empty()) {
            *lang_counts.entry(l).or_default() += weight.max(1);
        }
    };

    let intervals = detect_vad_intervals_i16(samples_i16, &vad_config)?;

    if intervals.is_empty() {
        tracing::warn!("VAD 未检出语音段，回退为整段转写");
        let out = engine.transcribe(samples_i16, 0, &options)?;
        record_lang(out.lang.clone(), out.items.len());
        on_interval(&out.items, 0, 1)?;
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
            record_lang(out.lang.clone(), out.items.len());
            on_interval(&out.items, idx, total)?;
            all_segments.extend(out.items);
        }
    }

    let output = finalize_segments(all_segments, lang_counts);
    tracing::info!(
        "[whisper] 识别段数: {}（后续由 subtitle 清洗去重）",
        output.items.len()
    );
    Ok(output)
}

/// 对已提取的 16kHz mono WAV 做 VAD 切分 + Whisper 识别。
pub fn recognize_wav_voice(
    wav_path: &Path,
    vad_config: Option<VadConfig>,
    whisper_engine_config: Option<WhisperEngineConfig>,
    whisper_transcribe_config: Option<WhisperTranscribeConfig>,
) -> Result<WhisperTranscribeOutput> {
    let samples_i16 = load_wav_i16_mono16k(wav_path)?;
    tracing::info!(
        wav = %wav_path.display(),
        samples = samples_i16.len(),
        dur_s = samples_i16.len() as f64 / SAMPLE_RATE as f64,
        "[whisper] 已加载 WAV"
    );

    recognize_pcm_i16(
        &samples_i16,
        vad_config,
        whisper_engine_config,
        whisper_transcribe_config,
    )
}

/// 识别视频中的语音：经管道提取 PCM，再 VAD + Whisper。
pub async fn recognize_video_voice(
    video_path: &Path,
    vad_config: Option<VadConfig>,
    whisper_engine_config: Option<WhisperEngineConfig>,
    whisper_transcribe_config: Option<WhisperTranscribeConfig>,
) -> Result<WhisperTranscribeOutput> {
    let samples = extract_pcm_i16_mono16k(video_path)
        .await
        .with_context(|| format!("提取 PCM 失败: {}", video_path.display()))?;

    spawn_blocking(move || {
        recognize_pcm_i16(
            &samples,
            vad_config,
            whisper_engine_config,
            whisper_transcribe_config,
        )
    })
    .await
    .context("Whisper 识别任务 join 失败")?
}
