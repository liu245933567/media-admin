use anyhow::{anyhow, bail, Result};
use serde::{Deserialize, Serialize};
use webrtc_vad::{SampleRate, Vad, VadMode};

/// VAD 配置
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct VadConfig {
    /// 帧长 10/20/30（默认 30）
    pub frame_ms: u16,
    /// 模式 0..=3（越大越激进，默认 2）
    pub mode: u8,
    /// 语音段两侧 padding（ms）（默认 300）
    pub padding_ms: u32,
    /// 丢弃短于该值的语音段（ms）（默认 200）
    pub min_speech_ms: u32,
    /// 单段最大长度（ms），超过会被硬切。`0` 表示不限制。
    /// 默认 30000（30s）：whisper 内部以 30s 滑窗解码，限到 30s 速度与上下文都更稳。
    pub max_segment_ms: u32,
}

impl Default for VadConfig {
    fn default() -> Self {
        Self {
            frame_ms: 30,
            mode: 2,
            padding_ms: 300,
            min_speech_ms: 200,
            max_segment_ms: 30_000,
        }
    }
}

/// 把过长的语音段硬切成多段（在 16kHz 采样率下计算）。
fn split_long_intervals(
    intervals: Vec<(usize, usize)>,
    max_segment_ms: u32,
) -> Vec<(usize, usize)> {
    if max_segment_ms == 0 {
        return intervals;
    }
    let max_samples = (max_segment_ms as usize) * 16; // 16 samples / ms @ 16kHz
    let mut out = Vec::with_capacity(intervals.len());
    for (s, e) in intervals {
        if e <= s {
            continue;
        }
        let mut cur = s;
        while e - cur > max_samples {
            out.push((cur, cur + max_samples));
            cur += max_samples;
        }
        out.push((cur, e));
    }
    out
}

fn vad_frame_samples(frame_ms: u16) -> Result<usize> {
    match frame_ms {
        10 => Ok(160),
        20 => Ok(320),
        30 => Ok(480),
        _ => bail!("VAD_FRAME_MS 必须为 10/20/30, 当前: {frame_ms}"),
    }
}

pub fn detect_vad_intervals_i16(pcm: &[i16], config: VadConfig) -> Result<Vec<(usize, usize)>> {
    let frame = vad_frame_samples(config.frame_ms)?;
    let mode = match config.mode.min(3) {
        0 => VadMode::Quality,
        1 => VadMode::LowBitrate,
        2 => VadMode::Aggressive,
        _ => VadMode::VeryAggressive,
    };
    let mut vad = Vad::new_with_rate_and_mode(SampleRate::Rate16kHz, mode);

    let n_frames = pcm.len() / frame;
    let mut voiced_flags: Vec<bool> = Vec::with_capacity(n_frames);
    for i in 0..n_frames {
        let start = i * frame;
        let end = start + frame;
        let is_voice = vad
            .is_voice_segment(&pcm[start..end])
            .map_err(|_| anyhow!("vad.is_voice_segment: invalid frame length"))?;
        voiced_flags.push(is_voice);
    }

    let pad_frames = (config.padding_ms as usize) / (config.frame_ms as usize);
    let min_frames = ((config.min_speech_ms as usize) / (config.frame_ms as usize)).max(1);

    // 找连续语音帧区间
    let mut raw: Vec<(isize, isize)> = Vec::new();
    let mut i = 0usize;
    while i < voiced_flags.len() {
        if !voiced_flags[i] {
            i += 1;
            continue;
        }
        let start = i;
        while i < voiced_flags.len() && voiced_flags[i] {
            i += 1;
        }
        let end_incl = i.saturating_sub(1);
        raw.push((start as isize, end_incl as isize));
    }

    // 扩展 padding 并合并重叠区间
    let mut expanded: Vec<(isize, isize)> = raw
        .into_iter()
        .map(|(s, e)| (s - pad_frames as isize, e + pad_frames as isize))
        .map(|(s, e)| {
            (
                s.max(0),
                e.min(voiced_flags.len().saturating_sub(1) as isize),
            )
        })
        .collect();
    expanded.sort_by_key(|(s, _)| *s);

    let mut merged: Vec<(isize, isize)> = Vec::new();
    for (s, e) in expanded {
        if let Some(last) = merged.last_mut() {
            if s <= last.1 + 1 {
                last.1 = last.1.max(e);
                continue;
            }
        }
        merged.push((s, e));
    }

    // 转成 sample index 区间，并过滤过短片段
    let mut out: Vec<(usize, usize)> = Vec::new();
    for (s, e) in merged {
        let frames = (e - s + 1).max(0) as usize;
        if frames < min_frames {
            continue;
        }
        let start_samp = (s as usize) * frame;
        let end_samp = ((e as usize) + 1) * frame; // exclusive
        out.push((start_samp, end_samp.min(pcm.len())));
    }

    // 硬切超长段，避免单段送给 whisper 后内部滑窗过慢、上下文飘移
    Ok(split_long_intervals(out, config.max_segment_ms))
}
