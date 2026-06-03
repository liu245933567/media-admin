use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result, ensure};
use tokio::task::spawn_blocking;

use crate::{
    engine_cache::acquire_shared_engine,
    types::{
        VadConfig, WhisperEngineConfig, WhisperTranscribeConfig, WhisperTranscribeItem,
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

/// 流式 VAD 状态：缓存最近 PCM，持续追踪当前语音段并产出可解码区间。
struct StreamingVadState {
    vad_config: VadConfig,
    fallback_samples: Vec<i16>,
    pending: Vec<i16>,
    pending_start_sample: usize,
    processed_until_sample: usize,
    emitted_any: bool,
    in_voice: bool,
    current_start: usize,
    last_voice_end: usize,
    silence_samples: usize,
    max_segment_samples: usize,
}

impl StreamingVadState {
    /// 创建流式 VAD 状态。
    fn new(vad_config: VadConfig) -> Self {
        let max_segment_samples = if vad_config.max_segment_ms == 0 {
            usize::MAX
        } else {
            (vad_config.max_segment_ms as usize) * 16
        };
        Self {
            vad_config,
            fallback_samples: Vec::new(),
            pending: Vec::new(),
            pending_start_sample: 0,
            processed_until_sample: 0,
            emitted_any: false,
            in_voice: false,
            current_start: 0,
            last_voice_end: 0,
            silence_samples: 0,
            max_segment_samples,
        }
    }

    /// 追加一个 PCM 块，并返回当前已完整闭合的语音区间。
    fn push_chunk(&mut self, chunk: Vec<i16>) -> Result<Vec<(usize, Vec<i16>)>> {
        if !self.emitted_any {
            self.fallback_samples.extend_from_slice(&chunk);
        }
        self.pending.extend_from_slice(&chunk);
        self.process(false)
    }

    /// 输入结束时冲刷最后一个未闭合的语音区间。
    fn finish(mut self) -> Result<Vec<(usize, Vec<i16>)>> {
        self.process(true)
    }

    /// 扫描 pending PCM，更新 VAD 状态并收集可提交区间。
    fn process(&mut self, flush: bool) -> Result<Vec<(usize, Vec<i16>)>> {
        let intervals = detect_vad_intervals_i16(&self.pending, &self.vad_config)?;
        let mut ready = Vec::new();
        let padding_samples = (self.vad_config.padding_ms as usize) * 16;
        let min_speech_samples = (self.vad_config.min_speech_ms as usize).max(1) * 16;

        for (local_start, local_end) in intervals {
            let abs_start = self.pending_start_sample + local_start;
            let abs_end = self.pending_start_sample + local_end;
            if abs_end <= self.processed_until_sample {
                continue;
            }
            if !self.in_voice {
                self.in_voice = true;
                self.current_start = abs_start.saturating_sub(padding_samples);
            }
            self.last_voice_end = self.last_voice_end.max(abs_end);
            if self.last_voice_end.saturating_sub(self.current_start) >= self.max_segment_samples {
                ready.extend(self.emit_current(self.last_voice_end, min_speech_samples));
            }
        }

        let consumed_until = self.pending_start_sample + self.pending.len();
        if self.in_voice {
            self.silence_samples = consumed_until.saturating_sub(self.last_voice_end);
            if self.silence_samples >= padding_samples {
                let end = self
                    .last_voice_end
                    .saturating_add(padding_samples)
                    .min(consumed_until);
                ready.extend(self.emit_current(end, min_speech_samples));
            }
        }

        if flush {
            if self.in_voice {
                ready.extend(self.emit_current(consumed_until, min_speech_samples));
            } else if !self.emitted_any && !self.fallback_samples.is_empty() {
                tracing::warn!("流式 VAD 未检出语音段，回退为整段转写");
                self.emitted_any = true;
                ready.push((0, std::mem::take(&mut self.fallback_samples)));
            }
        } else {
            self.processed_until_sample = consumed_until;
            self.trim_pending();
        }

        Ok(ready)
    }

    /// 将当前语音段转成绝对起点和 PCM 样本。
    fn emit_current(
        &mut self,
        end_sample: usize,
        min_speech_samples: usize,
    ) -> Vec<(usize, Vec<i16>)> {
        let start = self.current_start;
        let end = end_sample.max(start);
        self.in_voice = false;
        self.silence_samples = 0;

        if end.saturating_sub(start) < min_speech_samples {
            return Vec::new();
        }

        match self.slice_abs(start, end) {
            Some(samples) => {
                self.emitted_any = true;
                self.fallback_samples.clear();
                vec![(start, samples)]
            }
            None => Vec::new(),
        }
    }

    /// 按绝对采样位置从 pending PCM 中切出样本。
    fn slice_abs(&self, start: usize, end: usize) -> Option<Vec<i16>> {
        if end <= start || start < self.pending_start_sample {
            return None;
        }
        let local_start = start - self.pending_start_sample;
        let local_end = end
            .saturating_sub(self.pending_start_sample)
            .min(self.pending.len());
        if local_start >= local_end || local_start >= self.pending.len() {
            return None;
        }
        Some(self.pending[local_start..local_end].to_vec())
    }

    /// 清理已经不再参与 VAD 判断的旧 PCM。
    fn trim_pending(&mut self) {
        let keep_from = if self.in_voice {
            self.current_start.saturating_sub(self.pending_start_sample)
        } else {
            let keep_samples = (self.vad_config.padding_ms as usize) * 16;
            self.pending.len().saturating_sub(keep_samples)
        };
        if keep_from == 0 {
            return;
        }
        self.pending.drain(..keep_from);
        self.pending_start_sample += keep_from;
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

/// 对流式输入的 16kHz mono PCM 做 VAD 切分 + Whisper 识别。
///
/// 每识别出一个可提交区间就调用 `on_interval`，适合与视频读取和翻译重叠执行。
pub fn recognize_pcm_i16_chunk_stream<I, F>(
    chunks: I,
    vad_config: Option<VadConfig>,
    whisper_engine_config: Option<WhisperEngineConfig>,
    whisper_transcribe_config: Option<WhisperTranscribeConfig>,
    mut on_interval: F,
) -> Result<WhisperTranscribeOutput>
where
    I: IntoIterator<Item = Result<Vec<i16>>>,
    F: FnMut(&[WhisperTranscribeItem], usize, usize) -> Result<()>,
{
    tracing::info!("[whisper] 开始流式 PCM 识别");

    let engine = acquire_shared_engine(whisper_engine_config)?;
    let engine = engine
        .lock()
        .map_err(|e| anyhow::anyhow!("whisper 引擎 lock: {e}"))?;
    let options = whisper_transcribe_config.unwrap_or_default();
    let vad_config = vad_config.unwrap_or_default();
    let mut vad = StreamingVadState::new(vad_config);
    let mut all_segments: Vec<WhisperTranscribeItem> = Vec::new();
    let mut lang_counts: HashMap<String, usize> = HashMap::new();
    let mut interval_idx = 0usize;

    for chunk in chunks {
        let chunk = chunk?;
        for (start_sample, samples) in vad.push_chunk(chunk)? {
            let offset_cs = samples_to_cs(start_sample);
            let out = engine
                .transcribe(&samples, offset_cs, &options)
                .with_context(|| format!("流式 VAD 段 #{interval_idx} 解码失败"))?;
            if let Some(l) = out.lang.clone().filter(|s| !s.is_empty()) {
                *lang_counts.entry(l).or_default() += out.items.len().max(1);
            }
            on_interval(&out.items, interval_idx, 0)?;
            all_segments.extend(out.items);
            interval_idx += 1;
        }
    }

    for (start_sample, samples) in vad.finish()? {
        let offset_cs = samples_to_cs(start_sample);
        let out = engine
            .transcribe(&samples, offset_cs, &options)
            .with_context(|| format!("流式 VAD 段 #{interval_idx} 解码失败"))?;
        if let Some(l) = out.lang.clone().filter(|s| !s.is_empty()) {
            *lang_counts.entry(l).or_default() += out.items.len().max(1);
        }
        on_interval(&out.items, interval_idx, 0)?;
        all_segments.extend(out.items);
        interval_idx += 1;
    }

    tracing::info!("[whisper] 流式识别完成: {interval_idx} 个区间");
    Ok(finalize_segments(all_segments, lang_counts))
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
