use std::path::Path;

use anyhow::{ensure, Context, Result};

use crate::core::{
    ffmpeg::extract_wav_16k_mono,
    subtitle_file::write_srt_file,
    vad::{detect_vad_intervals_i16, VadConfig},
    whisper::{WhisperEngine, WhisperEngineConfig, WhisperOptions, WhisperTranscribeItem},
};

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

pub async fn generate_subtitle(
    video_path: &Path,
    vad_config: Option<VadConfig>,
) -> Result<String> {
    generate_subtitle_with(video_path, vad_config, None, None).await
}

/// 进阶入口：可自定义 whisper 引擎配置和解码参数。
pub async fn generate_subtitle_with(
    video_path: &Path,
    vad_config: Option<VadConfig>,
    engine_cfg: Option<WhisperEngineConfig>,
    options: Option<WhisperOptions>,
) -> Result<String> {
    let wav_path = extract_wav_16k_mono(video_path).await.with_context(|| {
        format!("提取 WAV 失败: {}", video_path.display())
    })?;

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

    match vad_config {
        Some(vad_config) => {
            let intervals = detect_vad_intervals_i16(&samples_i16, vad_config)?;

            if intervals.is_empty() {
                tracing::warn!("VAD 未检出语音段，回退为整段转写");
                let segs = engine.transcribe(&samples_i16, 0, &options)?;
                all_segments.extend(segs);
            } else {
                let total = intervals.len();
                tracing::info!("VAD 检出 {total} 个语音段");
                for (idx, (s, e)) in intervals.iter().enumerate() {
                    let offset_cs = samples_to_cs(*s);
                    let dur_cs = samples_to_cs(e.saturating_sub(*s));
                    tracing::info!(
                        "[VAD #{idx}/{total}] samples=[{s}, {e}) offset={offset_cs}cs dur={dur_cs}cs"
                    );
                    let segs = engine
                        .transcribe(&samples_i16[*s..*e], offset_cs, &options)
                        .with_context(|| format!("VAD 段 #{idx} 解码失败"))?;
                    all_segments.extend(segs);
                }
            }
        }
        None => {
            let segs = engine.transcribe(&samples_i16, 0, &options)?;
            all_segments.extend(segs);
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

    let srt_path = write_srt_file(video_path, None, &all_segments)
        .with_context(|| format!("写入 SRT 失败: {}", video_path.display()))?;

    tracing::info!("[subtitle] 字幕生成完成: {}", srt_path.display());
    Ok(srt_path.display().to_string())
}
