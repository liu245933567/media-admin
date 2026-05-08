use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use anyhow::Result;
use whisper_rs::{
    convert_integer_to_float_audio, install_logging_hooks, FullParams, SamplingStrategy,
    SegmentCallbackData, WhisperContext, WhisperContextParameters,
};
use crate::{config::MODELS_DIR, core::subtitle_file::fmt_srt_ts_centiseconds};
use anyhow::anyhow;

/// whisper 语音识别结果 - 列表单项
#[derive(Clone, Debug)]
pub struct WhisperTranscribeItem {
    /// 开始时间戳（毫秒）
    pub start_cs: i64,
    /// 结束时间戳（毫秒）
    pub end_cs: i64,
    /// 语音识别结果
    pub text: String,
}

/// whisper 语音识别
pub fn whisper_transcribe(samples_i16: &Vec<i16>) -> Result<Vec<WhisperTranscribeItem>> {
    let model_path = Path::new(MODELS_DIR).join("ggml-large-v3-turbo.bin");

    if !model_path.exists() {
        anyhow::bail!("模型文件不存在: {}", model_path.display());
    }

    // 禁用/重定向 whisper.cpp 与 ggml 的内部日志，避免刷屏输出到 stderr/stdout。
    // 若未启用 `log_backend`/`tracing_backend` feature，则相当于静默。
    install_logging_hooks();

    let mut audio = vec![0.0f32; samples_i16.len()];
    convert_integer_to_float_audio(&samples_i16, &mut audio)?;

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
    let segments: Arc<Mutex<Vec<WhisperTranscribeItem>>> = Arc::new(Mutex::new(Vec::new()));
    let segments_for_cb = Arc::clone(&segments);
    params.set_segment_callback_safe_lossy::<
        Option<Box<dyn FnMut(SegmentCallbackData)>>,
        Box<dyn FnMut(SegmentCallbackData)>,
    >(Some(Box::new(move |seg: SegmentCallbackData| {
        let text_trim = seg.text.trim_end();
        if text_trim.is_empty() {
            return;
        }

        let t0 = fmt_srt_ts_centiseconds(seg.start_timestamp);
        let t1 = fmt_srt_ts_centiseconds(seg.end_timestamp);
        tracing::info!("{t0} ~ {t1}  {text_trim}");

        if let Ok(mut guard) = segments_for_cb.lock() {
            guard.push(WhisperTranscribeItem {
                start_cs: seg.start_timestamp,
                end_cs: seg.end_timestamp,
                text: seg.text,
            });
        }
    })));

    state
        .full(params, &audio)
        .map_err(|e| anyhow!("识别失败: {e}"))?;

    let segs = segments
        .lock()
        .map_err(|_| anyhow!("SRT segments lock poisoned"))?;

    Ok(segs.clone())
}
