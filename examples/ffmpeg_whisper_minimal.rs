use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use dotenvy::dotenv;
use webrtc_vad::{SampleRate, Vad, VadMode};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(Clone, Debug)]
struct Seg {
    start_cs: i64,
    end_cs: i64,
    text: String,
}

fn fmt_ts_centiseconds(cs: i64) -> String {
    let ms_total: u64 = cs.saturating_mul(10).max(0) as u64;
    let h = ms_total / 3_600_000;
    let m = (ms_total / 60_000) % 60;
    let s = (ms_total / 1_000) % 60;
    let ms = ms_total % 1_000;
    format!("{h}:{m:02}:{s:02}.{ms:03}")
}

fn fmt_srt_ts_centiseconds(cs: i64) -> String {
    let ms_total: u64 = cs.saturating_mul(10).max(0) as u64;
    let h = ms_total / 3_600_000;
    let m = (ms_total / 60_000) % 60;
    let s = (ms_total / 1_000) % 60;
    let ms = ms_total % 1_000;
    format!("{h:02}:{m:02}:{s:02},{ms:03}")
}

fn write_srt(path: &Path, segments: &[Seg]) -> anyhow::Result<()> {
    let mut out = String::new();
    let mut idx = 1usize;
    for seg in segments {
        let text = seg.text.trim();
        if text.is_empty() {
            continue;
        }

        // SRT 要求 end > start；若相等则让 end + 1cs（10ms）
        let s0 = seg.start_cs;
        let mut s1 = seg.end_cs;
        if s1 <= s0 {
            s1 = s0 + 1;
        }

        out.push_str(&format!("{idx}\n"));
        out.push_str(&format!(
            "{} --> {}\n",
            fmt_srt_ts_centiseconds(s0),
            fmt_srt_ts_centiseconds(s1)
        ));
        out.push_str(text);
        out.push_str("\n\n");
        idx += 1;
    }
    std::fs::write(path, out)?;
    Ok(())
}

fn default_srt_path(input_media: &Path) -> PathBuf {
    let mut p = input_media.to_path_buf();
    p.set_extension("srt");
    p
}

fn main() -> anyhow::Result<()> {
    // 从项目根目录加载 `.env`（若不存在则忽略）
    dotenv().ok();
    // 禁用/重定向 whisper.cpp 与 ggml 的内部日志，避免刷屏输出到 stderr/stdout。
    // 若未启用 `log_backend`/`tracing_backend` feature，则相当于静默。
    whisper_rs::install_logging_hooks();

    let input_media_path = std::env::args()
        .nth(1)
        .ok_or_else(|| anyhow::anyhow!("缺少要目标视频路径参数，用法: cargo run --example ffmpeg_whisper_minimal -- <input_media_path>"))?;

    // 必填：模型路径（文件或目录）。目录时你可以自行传具体 bin 文件路径；
    // 这里保持最小示例，不做目录扫描。
    let model_path = std::env::var("WHISPER_MODEL_PATH")
        .map_err(|_| anyhow::anyhow!("缺少环境变量 WHISPER_MODEL_PATH（例如 static/models/whisper-large-v3-turbo/ggml-large-v3-turbo.bin）"))?;

    // 可选：ffmpeg 可执行文件路径；默认使用 PATH 中的 ffmpeg
    let ffmpeg = std::env::var("FFMPEG_PATH").unwrap_or_else(|_| "ffmpeg".to_string());

    let input_media_pathbuf = PathBuf::from(&input_media_path);
    let srt_out_path = std::env::var("SRT_OUTPUT")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| default_srt_path(&input_media_pathbuf));

    let wav_path = temp_wav_path("whisper_rs_minimal_");
    extract_wav_16k_mono(&ffmpeg, Path::new(&input_media_path), &wav_path)?;

    let mut samples_i16: Vec<i16> = hound::WavReader::open(&wav_path)?
        .into_samples::<i16>()
        .collect::<Result<Vec<_>, _>>()?;

    // 可选：VAD 过滤（等价于“去静音/去背景”预处理）
    // - 默认开启：VAD_ENABLED=1
    // - 关闭：VAD_ENABLED=0
    // - 模式：VAD_MODE=0..3（越大越激进，默认 2）
    // - 帧长：VAD_FRAME_MS=10/20/30（默认 30）
    // - padding：VAD_PADDING_MS（默认 300）
    // - 最短语音：VAD_MIN_SPEECH_MS（默认 200）
    let vad_enabled = std::env::var("VAD_ENABLED")
        .ok()
        .and_then(|s| s.parse::<u8>().ok())
        .unwrap_or(1)
        != 0;
    if vad_enabled {
        let frame_ms = std::env::var("VAD_FRAME_MS")
            .ok()
            .and_then(|s| s.parse::<u16>().ok())
            .unwrap_or(30);
        let mode = std::env::var("VAD_MODE")
            .ok()
            .and_then(|s| s.parse::<u8>().ok())
            .unwrap_or(2);
        let padding_ms = std::env::var("VAD_PADDING_MS")
            .ok()
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(300);
        let min_speech_ms = std::env::var("VAD_MIN_SPEECH_MS")
            .ok()
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(200);

        let intervals =
            detect_vad_intervals_i16(&samples_i16, frame_ms, mode, padding_ms, min_speech_ms)?;
        if !intervals.is_empty() {
            let mut filtered: Vec<i16> = Vec::with_capacity(samples_i16.len());
            for (s, e) in intervals {
                filtered.extend_from_slice(&samples_i16[s..e]);
            }
            samples_i16 = filtered;
        }
    }

    let mut audio = vec![0.0f32; samples_i16.len()];
    whisper_rs::convert_integer_to_float_audio(&samples_i16, &mut audio)?;

    let mut ctx_params = WhisperContextParameters::default();
    ctx_params.use_gpu = true;
    // 若你的 whisper.cpp / GPU 后端支持 flash attention，可进一步提速
    //（不支持时通常会被忽略或不生效；保持最小示例，不做能力探测）
    ctx_params.flash_attn = true;

    let ctx = WhisperContext::new_with_params(&model_path, ctx_params)
        .map_err(|e| anyhow::anyhow!("加载模型失败: {e}"))?;
    let mut state = ctx
        .create_state()
        .map_err(|e| anyhow::anyhow!("创建 state 失败: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    // 实时输出 + 收集 segments，结束后写 SRT
    let segments: Arc<Mutex<Vec<Seg>>> = Arc::new(Mutex::new(Vec::new()));
    let segments_for_cb = Arc::clone(&segments);
    params.set_segment_callback_safe_lossy::<
        Option<Box<dyn FnMut(whisper_rs::SegmentCallbackData)>>,
        Box<dyn FnMut(whisper_rs::SegmentCallbackData)>,
    >(Some(Box::new(move |seg: whisper_rs::SegmentCallbackData| {
        let text_trim = seg.text.trim_end();
        if text_trim.is_empty() {
            return;
        }

        let t0 = fmt_ts_centiseconds(seg.start_timestamp);
        let t1 = fmt_ts_centiseconds(seg.end_timestamp);
        println!("{t0} ~ {t1}  {text_trim}");

        if let Ok(mut guard) = segments_for_cb.lock() {
            guard.push(Seg {
                start_cs: seg.start_timestamp,
                end_cs: seg.end_timestamp,
                text: seg.text,
            });
        }
    })));

    state
        .full(params, &audio)
        .map_err(|e| anyhow::anyhow!("识别失败: {e}"))?;

    let segs = segments
        .lock()
        .map_err(|_| anyhow::anyhow!("SRT segments lock poisoned"))?;
    write_srt(&srt_out_path, &segs)?;

    let _ = std::fs::remove_file(&wav_path);
    Ok(())
}

fn vad_frame_samples(frame_ms: u16) -> anyhow::Result<usize> {
    match frame_ms {
        10 => Ok(160),
        20 => Ok(320),
        30 => Ok(480),
        _ => anyhow::bail!("VAD_FRAME_MS 必须为 10/20/30，当前 {frame_ms}"),
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
    Ok(out)
}

fn extract_wav_16k_mono(ffmpeg: &str, input: &Path, output_wav: &Path) -> anyhow::Result<()> {
    let status = Command::new(ffmpeg)
        .arg("-y")
        .arg("-i")
        .arg(input)
        .args(["-vn", "-ac", "1", "-ar", "16000"])
        .arg("-f")
        .arg("wav")
        .arg(output_wav)
        .status()
        .map_err(|e| anyhow::anyhow!("运行 ffmpeg 失败（ffmpeg={ffmpeg}）: {e}"))?;

    if !status.success() {
        return Err(anyhow::anyhow!(
            "ffmpeg 退出码异常: {status}. 请确认 ffmpeg 可用，或设置环境变量 FFMPEG_PATH 指向可执行文件。"
        ));
    }
    Ok(())
}

fn temp_wav_path(prefix: &str) -> PathBuf {
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let pid = std::process::id();
    std::env::temp_dir().join(format!("{prefix}{pid}_{now_ms}.wav"))
}
