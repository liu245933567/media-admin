//! 基于 `whisper-rs`（whisper.cpp）的转写；解码完成后按分段写入日志。
use anyhow::Context;
use std::path::Path;
use std::sync::{Arc, Mutex};
use webrtc_vad::{SampleRate, Vad, VadMode};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Debug, Clone)]
pub struct TimedText {
    pub t0_ms: i64,
    pub t1_ms: i64,
    pub text: String,
}

/// 解码可调参数（束搜索 / greedy、提示词、语言等）。
#[derive(Debug, Clone)]
pub struct WhisperTranscribeParams {
    pub language: Option<String>,
    pub starting_prompt: Option<String>,
    pub beam_size: i32,
    pub patience: f32,
    pub best_of: i32,
    pub length_penalty: f32,

    /// 启用 VAD 分段转写（保持原始时间戳：每段结果会加回 offset）。
    pub vad_enable: bool,
    /// webrtcvad aggressiveness: 0..=3
    pub vad_mode: u8,
    /// VAD 帧长（ms）：10/20/30
    pub vad_frame_ms: u16,
    /// 语音段两侧 padding（ms）
    pub vad_padding_ms: u32,
    /// 丢弃短于该值的语音段（ms）
    pub vad_min_speech_ms: u32,
}

impl Default for WhisperTranscribeParams {
    fn default() -> Self {
        Self {
            language: None,
            starting_prompt: None,
            beam_size: 5,
            patience: -1.0,
            best_of: 5,
            length_penalty: -1.0,

            vad_enable: false,
            vad_mode: 2,
            vad_frame_ms: 30,
            vad_padding_ms: 200,
            vad_min_speech_ms: 300,
        }
    }
}

const LOG_CAP: usize = 500;

fn append_line(lines: &Arc<Mutex<Vec<String>>>, line: String) {
    let mut g = lines.lock().unwrap();
    g.push(line);
    if g.len() > LOG_CAP {
        let n = g.len() - LOG_CAP;
        g.drain(0..n);
    }
}

fn device_requests_gpu(device: &str) -> bool {
    matches!(
        device.trim().to_ascii_lowercase().as_str(),
        "cuda" | "gpu"
    )
}

fn use_flash_attn(compute_type: &str) -> bool {
    compute_type.to_ascii_lowercase().contains("flash")
}

#[cfg(feature = "cuda")]
fn runtime_can_use_gpu(device: &str) -> bool {
    matches!(
        device.trim().to_ascii_lowercase().as_str(),
        "cuda" | "gpu"
    )
}

#[cfg(not(feature = "cuda"))]
fn runtime_can_use_gpu(device: &str) -> bool {
    let _ = device;
    false
}

fn load_wav_i16_mono16k(path: &Path) -> anyhow::Result<Vec<i16>> {
    let mut reader =
        hound::WavReader::open(path).with_context(|| format!("打开 WAV {}", path.display()))?;
    let spec = reader.spec();
    anyhow::ensure!(
        spec.sample_rate == 16_000,
        "需要 16 kHz 单声道 WAV（ffmpeg 已指定 -ar 16000），当前采样率为 {} Hz",
        spec.sample_rate
    );
    match spec.sample_format {
        hound::SampleFormat::Int => {
            anyhow::ensure!(
                spec.bits_per_sample == 16,
                "暂仅支持 16-bit PCM WAV，当前为 {} bit",
                spec.bits_per_sample
            );
            let samples: Vec<i16> = reader
                .samples::<i16>()
                .collect::<Result<_, _>>()
                .context("读取 WAV 采样")?;
            anyhow::ensure!(
                spec.channels == 1,
                "需要单声道 WAV（ffmpeg 使用 -ac 1），当前 {} 声道",
                spec.channels
            );
            Ok(samples)
        }
        hound::SampleFormat::Float => {
            anyhow::bail!("暂不支持浮点 WAV，请在 ffmpeg 使用 pcm_s16le");
        }
    }
}

fn centiseconds_to_ms(cs: i64) -> i64 {
    cs.saturating_mul(10)
}

fn samples_to_ms(samples: usize) -> i64 {
    ((samples as i64).saturating_mul(1000)).saturating_div(16_000)
}

fn vad_frame_samples(frame_ms: u16) -> anyhow::Result<usize> {
    match frame_ms {
        10 => Ok(160),
        20 => Ok(320),
        30 => Ok(480),
        _ => anyhow::bail!("VAD frame_ms 必须为 10/20/30，当前 {frame_ms}"),
    }
}

fn detect_vad_intervals_i16(
    pcm: &[i16],
    frame_ms: u16,
    mode: u8,
    padding_ms: u32,
    min_speech_ms: u32,
) -> anyhow::Result<Vec<(usize, usize)>> {
    let frame = vad_frame_samples(frame_ms)?;
    let mode = match mode.min(3) {
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
            .map_err(|_| anyhow::anyhow!("vad.is_voice_segment: invalid frame length"))?;
        voiced_flags.push(is_voice);
    }

    let pad_frames = (padding_ms as usize) / (frame_ms as usize);
    let min_frames = ((min_speech_ms as usize) / (frame_ms as usize)).max(1);

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

    let mut expanded: Vec<(isize, isize)> = raw
        .into_iter()
        .map(|(s, e)| (s - pad_frames as isize, e + pad_frames as isize))
        .map(|(s, e)| (s.max(0), e.min(voiced_flags.len().saturating_sub(1) as isize)))
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
    Ok(out)
}

fn decode_one(
    ctx: &WhisperContext,
    pcm_f32: &[f32],
    decode: &WhisperTranscribeParams,
    log_lines: &Arc<Mutex<Vec<String>>>,
    offset_ms: i64,
) -> anyhow::Result<Vec<TimedText>> {
    let mut state = ctx.create_state().context("create_state")?;

    let strategy = if decode.beam_size > 1 {
        SamplingStrategy::BeamSearch {
            beam_size: decode.beam_size,
            patience: decode.patience,
        }
    } else {
        SamplingStrategy::Greedy {
            best_of: decode.best_of.max(1),
        }
    };

    let mut params = FullParams::new(strategy);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_length_penalty(decode.length_penalty);

    match decode
        .language
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        None | Some("auto") => params.set_detect_language(true),
        Some(code) => params.set_language(Some(code)),
    }

    if let Some(ref p) = decode.starting_prompt {
        let t = p.trim();
        if !t.is_empty() {
            params.set_initial_prompt(t);
        }
    }

    state
        .full(params, pcm_f32)
        .map_err(|e| anyhow::anyhow!("whisper full decode 失败: {e}"))?;

    let lang_id = state.full_lang_id_from_state();
    let lang = whisper_rs::get_lang_str(lang_id).unwrap_or("?");
    append_line(
        log_lines,
        format!(
            "[Whisper] 解码结束，选用语言 {}（id {}），段数 {}",
            lang,
            lang_id,
            state.full_n_segments()
        ),
    );

    let mut out = Vec::new();
    for segment in state.as_iter() {
        let text = segment.to_str_lossy().unwrap_or_default().trim().to_string();
        if text.is_empty() {
            continue;
        }
        let preview = text.replace('\n', " ");
        let short = if preview.chars().count() > 72 {
            format!("{}…", preview.chars().take(72).collect::<String>())
        } else {
            preview.clone()
        };
        append_line(
            log_lines,
            format!(
                "[Whisper] 片段 #{} [{:.2}s – {:.2}s] {}",
                segment.segment_index(),
                (offset_ms as f64 / 1000.0) + (segment.start_timestamp() as f64 / 100.0),
                (offset_ms as f64 / 1000.0) + (segment.end_timestamp() as f64 / 100.0),
                short
            ),
        );
        out.push(TimedText {
            t0_ms: offset_ms + centiseconds_to_ms(segment.start_timestamp()),
            t1_ms: offset_ms + centiseconds_to_ms(segment.end_timestamp()),
            text,
        });
    }
    Ok(out)
}

/// 在 `spawn_blocking` 内调用；日志写入 `log_lines`（与外层任务轮询共享）。
pub fn transcribe_wav_with_logs(
    model_path_str: String,
    wav_path_str: String,
    device: String,
    compute_type: String,
    decode: WhisperTranscribeParams,
    log_lines: Arc<Mutex<Vec<String>>>,
) -> anyhow::Result<Vec<TimedText>> {
    let wav_path = Path::new(&wav_path_str);
    let model_file = Path::new(&model_path_str);

    append_line(
        &log_lines,
        format!(
            "[Env] whisper-rs / whisper.cpp {}",
            whisper_rs::get_whisper_version()
        ),
    );

    let want_gpu = device_requests_gpu(&device);
    let gpu_ok = runtime_can_use_gpu(&device);
    if want_gpu && !gpu_ok {
        #[cfg(not(feature = "cuda"))]
        append_line(
            &log_lines,
            "[Whisper] WHISPER_DEVICE 请求 GPU，但当前二进制未启用 `cuda` feature；将以 CPU 运行。使用 `cargo build --features cuda` 并在本机安装 CUDA 后再试。"
                .to_string(),
        );
    }

    let mut ctx_params = WhisperContextParameters::default();
    ctx_params.use_gpu = gpu_ok && want_gpu;
    ctx_params.flash_attn = ctx_params.use_gpu && use_flash_attn(&compute_type);

    append_line(
        &log_lines,
        format!(
            "[Whisper] 加载模型 {}（GPU={} flash_attn={}）",
            model_file.display(),
            ctx_params.use_gpu,
            ctx_params.flash_attn
        ),
    );

    let ctx =
        WhisperContext::new_with_params(model_file.to_str().context("模型路径非 UTF-8")?, ctx_params)
            .context("WhisperContext::new_with_params")?;

    let pcm_i16 = load_wav_i16_mono16k(wav_path)?;
    let dur_s = pcm_i16.len() as f64 / 16_000.0;
    let mut sum_sq = 0.0f64;
    let mut peak = 0.0f64;
    for &x in &pcm_i16 {
        let xf = x as f64 / 32768.0;
        let ax = xf.abs();
        if ax > peak {
            peak = ax;
        }
        sum_sq += xf * xf;
    }
    let rms = if pcm_i16.is_empty() {
        0.0
    } else {
        (sum_sq / pcm_i16.len() as f64).sqrt()
    };
    append_line(
        &log_lines,
        format!(
            "[Whisper] 音频样本 {}（约 {:.1}s，16 kHz mono i16，rms={:.6} peak={:.6}）",
            wav_path.display(),
            dur_s,
            rms,
            peak
        ),
    );
    if dur_s < 0.5 {
        append_line(
            &log_lines,
            "[Whisper] 警告：音频时长很短，可能抽取失败或原视频无有效音轨。".to_string(),
        );
    }
    if peak < 0.001 {
        append_line(
            &log_lines,
            "[Whisper] 警告：音频峰值很低，可能接近静音或音量过低，Whisper 可能返回空结果。"
                .to_string(),
        );
    }

    let mut out: Vec<TimedText> = Vec::new();

    if decode.vad_enable {
        append_line(
            &log_lines,
            format!(
                "[VAD] 开启：mode={} frame_ms={} padding_ms={} min_speech_ms={}",
                decode.vad_mode,
                decode.vad_frame_ms,
                decode.vad_padding_ms,
                decode.vad_min_speech_ms
            ),
        );
        let intervals = detect_vad_intervals_i16(
            &pcm_i16,
            decode.vad_frame_ms,
            decode.vad_mode,
            decode.vad_padding_ms,
            decode.vad_min_speech_ms,
        )?;
        append_line(&log_lines, format!("[VAD] 语音区间数 {}", intervals.len()));

        for (idx, (s, e)) in intervals.into_iter().enumerate() {
            let offset_ms = samples_to_ms(s);
            let seg_ms = samples_to_ms(e.saturating_sub(s).max(1));
            append_line(
                &log_lines,
                format!(
                    "[VAD] 区间 #{idx} samples=[{s},{e}) offset={}ms dur={}ms",
                    offset_ms, seg_ms
                ),
            );
            let slice = &pcm_i16[s..e];
            let mut pcm_f32 = vec![0f32; slice.len()];
            whisper_rs::convert_integer_to_float_audio(slice, &mut pcm_f32).context("i16 → f32")?;

            // 片段能量诊断 + 自动增益（帮助排除“音量太低导致 0 段”的情况）
            let mut sum_sq = 0.0f64;
            let mut peak = 0.0f64;
            for &x in &pcm_f32 {
                let ax = (x as f64).abs();
                if ax > peak {
                    peak = ax;
                }
                sum_sq += (x as f64) * (x as f64);
            }
            let rms = if pcm_f32.is_empty() {
                0.0
            } else {
                (sum_sq / pcm_f32.len() as f64).sqrt()
            };
            append_line(
                &log_lines,
                format!("[VAD] 区间 #{idx} 音量 rms={rms:.6} peak={peak:.6}"),
            );

            // 如果峰值很低，尝试放大后再送入 whisper（上限 20x，避免爆音）
            if peak > 0.0 && peak < 0.02 {
                let gain = (0.8 / peak).min(20.0);
                for v in &mut pcm_f32 {
                    *v = (*v as f64 * gain).clamp(-1.0, 1.0) as f32;
                }
                append_line(
                    &log_lines,
                    format!("[VAD] 区间 #{idx} 自动增益 x{gain:.2}（target_peak=0.8, cap=20x）"),
                );
            }

            let mut decoded = decode_one(&ctx, &pcm_f32, &decode, &log_lines, offset_ms)?;
            out.append(&mut decoded);
        }
    } else {
        let mut pcm_f32 = vec![0f32; pcm_i16.len()];
        whisper_rs::convert_integer_to_float_audio(&pcm_i16, &mut pcm_f32).context("i16 → f32")?;
        out = decode_one(&ctx, &pcm_f32, &decode, &log_lines, 0)?;
    }

    append_line(&log_lines, format!("[Whisper] 转写结束，共 {} 段", out.len()));
    Ok(out)
}
