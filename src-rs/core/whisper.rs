use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::Instant,
};

use anyhow::{anyhow, Context, Result};
use whisper_rs::{
    convert_integer_to_float_audio, get_lang_str, install_logging_hooks, FullParams,
    SamplingStrategy, SegmentCallbackData, WhisperContext, WhisperContextParameters,
};

use crate::{config::MODELS_DIR, core::subtitle_file::fmt_srt_ts_centiseconds};

/// whisper 语音识别结果 - 列表单项
#[derive(Clone, Debug)]
pub struct WhisperTranscribeItem {
    /// 开始时间戳（百毫秒，cs，1cs = 10ms）
    pub start_cs: i64,
    /// 结束时间戳（百毫秒，cs，1cs = 10ms）
    pub end_cs: i64,
    /// 语音识别文本（已 trim）
    pub text: String,
}

/// whisper 单次转写的整体输出（一段音频 → 多个文本段 + 整体语种）
#[derive(Clone, Debug, Default)]
pub struct WhisperTranscribeOutput {
    /// 文本段列表
    pub items: Vec<WhisperTranscribeItem>,
    /// 本次转写实际使用 / 自动检测到的语言短代码（如 `"zh"`、`"en"`）；
    /// 无法识别或无段输出时为 `None`。
    pub lang: Option<String>,
}

/// whisper 引擎运行时配置（影响模型加载，启动期决定）
#[derive(Clone, Debug)]
pub struct WhisperEngineConfig {
    /// 模型文件名（位于 [`MODELS_DIR`] 下）
    pub model_filename: String,
    /// 是否使用 GPU
    pub use_gpu: bool,
    /// 是否启用 flash attention。
    ///
    /// 注意：whisper.cpp 在 `BeamSearch + CUDA + flash_attn` 组合下会静默失败
    /// （forward pass 被跳过、瞬间返回 0 段）。本配置默认开启 flash_attn 是因为
    /// 默认解码策略是 Greedy，与 flash_attn 兼容。如果手动调到 BeamSearch
    /// 但发现段数总是 0，请把这里关掉。
    pub flash_attn: bool,
}

impl Default for WhisperEngineConfig {
    fn default() -> Self {
        Self {
            model_filename: "ggml-large-v3-turbo.bin".into(),
            use_gpu: true,
            flash_attn: true,
        }
    }
}

/// whisper 解码可调参数（影响每次 transcribe 行为）
#[derive(Clone, Debug)]
pub struct WhisperOptions {
    /// 语言代码：
    /// - `None`：完全用 whisper.cpp 编译默认（通常是 "en"），不调用 `set_xxx`。
    ///   最稳，与本机验证可工作的旧版兼容。
    /// - `Some("auto")`：调用 `set_detect_language(true)` 自动检测。**警告**：
    ///   某些 CUDA build 下检测路径会让 forward pass 异常瞬退，遇到 0 段时回 `None`。
    /// - `Some("zh"/"en"/...)`：显式锁定语言代码。
    pub language: Option<String>,
    /// 初始 prompt：可放专有名词、人名、风格示例（如 "以下是普通话简体中文字幕。"）。
    /// 为 `None` 时不调用 `set_initial_prompt`。
    pub initial_prompt: Option<String>,
    /// beam search 束宽：> 1 走 BeamSearch；<= 1 走 Greedy。
    ///
    /// 默认 1（Greedy）。BeamSearch 理论上更准，但部分 whisper.cpp CUDA 编译版本
    /// 会"静默失败"——forward pass 被跳过、瞬间返回 0 段。本机验证 OK 后再调高。
    pub beam_size: i32,
    /// Greedy 模式下的候选数 best_of，仅当 `beam_size <= 1` 时生效。
    ///
    /// 默认 1：与旧版 best_of 行为一致，确保 GPU 后端不会走异常 kernel 路径。
    /// 验证当前 build 兼容后可调到 5（whisper.cpp 默认值），轻微降低重复幻觉。
    pub greedy_best_of: i32,
    /// CPU 解码线程数。0 表示 `whisper.cpp` 自动（min(4, hw_concurrency)）。
    pub n_threads: i32,
    /// 是否在低音量片段做自动增益（peak<0.02 时拉到 0.8，封顶 20x）
    pub auto_gain: bool,
    /// 启用抗幻觉/重复参数组合
    /// （`temperature_inc` / `entropy_thold` / `logprob_thold` / `no_speech_thold` / ...）。
    ///
    /// **默认 `false`**。这些参数虽然多数与 whisper.cpp 默认值相同，但**显式调用
    /// set_xxx** 在某些 CUDA build 上会让 forward pass 异常瞬退、整段返回 0。
    /// 本机确认能正常出字幕后再开启可获得更稳定的"不识别 → 跳过"行为。
    pub anti_hallucination: bool,
}

impl Default for WhisperOptions {
    fn default() -> Self {
        Self {
            language: None,
            initial_prompt: None,
            beam_size: 1,
            greedy_best_of: 1,
            n_threads: 0,
            auto_gain: true,
            anti_hallucination: false,
        }
    }
}

/// 确保 `install_logging_hooks` 只调用一次（whisper-rs 是全局副作用）
fn ensure_logging_hooks() {
    static INIT: OnceLock<()> = OnceLock::new();
    INIT.get_or_init(|| {
        install_logging_hooks();
    });
}

/// whisper 引擎：模型只加载一次，可对多个语音片段重复转写
pub struct WhisperEngine {
    ctx: WhisperContext,
    cfg: WhisperEngineConfig,
}

impl WhisperEngine {
    /// 使用默认配置加载模型（GPU + flash_attn + large-v3-turbo）
    pub fn new() -> Result<Self> {
        Self::with_config(WhisperEngineConfig::default())
    }

    pub fn with_config(cfg: WhisperEngineConfig) -> Result<Self> {
        let model_path: PathBuf = Path::new(MODELS_DIR).join(&cfg.model_filename);
        if !model_path.exists() {
            anyhow::bail!("模型文件不存在: {}", model_path.display());
        }

        ensure_logging_hooks();

        let mut ctx_params = WhisperContextParameters::default();
        ctx_params.use_gpu = cfg.use_gpu;
        ctx_params.flash_attn = cfg.flash_attn;

        tracing::info!(
            model = %model_path.display(),
            use_gpu = ctx_params.use_gpu,
            flash_attn = ctx_params.flash_attn,
            "[whisper] 加载模型"
        );

        let ctx = WhisperContext::new_with_params(&model_path, ctx_params)
            .map_err(|e| anyhow!(e))
            .with_context(|| format!("加载模型失败: {}", model_path.display()))?;

        Ok(Self { ctx, cfg })
    }

    pub fn config(&self) -> &WhisperEngineConfig {
        &self.cfg
    }

    /// 转写单段 16kHz mono i16 PCM。
    ///
    /// `offset_cs` 是该片段在原音频中的起始时间偏移（cs，1cs=10ms）。
    /// 返回的每段时间戳都会加上 `offset_cs`，因此可直接拼成完整 SRT。
    pub fn transcribe(
        &self,
        samples_i16: &[i16],
        offset_cs: i64,
        options: &WhisperOptions,
    ) -> Result<WhisperTranscribeOutput> {
        if samples_i16.is_empty() {
            return Ok(WhisperTranscribeOutput::default());
        }

        let mut audio = vec![0.0f32; samples_i16.len()];
        convert_integer_to_float_audio(samples_i16, &mut audio)
            .context("convert_integer_to_float_audio 失败")?;

        // 音量诊断 + 自动增益
        let (peak, rms) = audio_peak_rms(&audio);
        let dur_s = audio.len() as f64 / 16_000.0;

        if options.auto_gain && peak > 0.0 && peak < 0.02 {
            let gain = (0.8f32 / peak).min(20.0);
            for v in &mut audio {
                *v = (*v * gain).clamp(-1.0, 1.0);
            }
            tracing::info!(offset_cs, gain, peak, "[whisper] 低音量自动增益");
        }

        let strategy = if options.beam_size > 1 {
            SamplingStrategy::BeamSearch {
                beam_size: options.beam_size,
                patience: -1.0,
            }
        } else {
            SamplingStrategy::Greedy {
                best_of: options.greedy_best_of.max(1),
            }
        };
        let mut params = FullParams::new(strategy);

        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        if options.n_threads > 0 {
            params.set_n_threads(options.n_threads);
        }

        // 抑制空白 + 抑制重复 / 幻觉的关键阈值组合（opt-in）
        // 在某些 whisper.cpp + CUDA build 下，**显式调用**这些 set_xxx 会让
        // forward pass 异常瞬退、整段返回 0，因此默认全部跳过保持兼容。
        if options.anti_hallucination {
            params.set_suppress_blank(true);
            params.set_temperature(0.0);
            params.set_temperature_inc(0.2);
            params.set_entropy_thold(2.4);
            params.set_logprob_thold(-1.0);
            params.set_no_speech_thold(0.6);
            params.set_length_penalty(-1.0);
        }

        // 语言：
        // - None      → 不调用任何 set_xxx，沿用 whisper.cpp 编译默认（与旧版兼容）
        // - "auto"    → 启用自动检测（部分 CUDA build 不稳定，谨慎使用）
        // - 具体语言码 → 显式锁定
        match options
            .language
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            None => {}
            Some("auto") => params.set_detect_language(true),
            Some(code) => params.set_language(Some(code)),
        }

        if let Some(p) = options
            .initial_prompt
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            params.set_initial_prompt(p);
        }

        let mut state = self
            .ctx
            .create_state()
            .map_err(|e| anyhow!("创建 state 失败: {e}"))?;

        // 实时打印 + 收集 segments
        let segments: Arc<Mutex<Vec<WhisperTranscribeItem>>> = Arc::new(Mutex::new(Vec::new()));
        let segments_for_cb = Arc::clone(&segments);
        params.set_segment_callback_safe_lossy::<
            Option<Box<dyn FnMut(SegmentCallbackData)>>,
            Box<dyn FnMut(SegmentCallbackData)>,
        >(Some(Box::new(move |seg: SegmentCallbackData| {
            let trimmed = seg.text.trim();
            if trimmed.is_empty() {
                return;
            }
            let abs_start = offset_cs.saturating_add(seg.start_timestamp);
            let abs_end = offset_cs.saturating_add(seg.end_timestamp);

            let t0 = fmt_srt_ts_centiseconds(abs_start);
            let t1 = fmt_srt_ts_centiseconds(abs_end);
            tracing::info!("{t0} --> {t1}  {trimmed}");

            if let Ok(mut guard) = segments_for_cb.lock() {
                guard.push(WhisperTranscribeItem {
                    start_cs: abs_start,
                    end_cs: abs_end,
                    text: trimmed.to_string(),
                });
            }
        })));

        tracing::debug!(
            offset_cs,
            samples = audio.len(),
            dur_s,
            rms,
            peak,
            beam_size = options.beam_size,
            best_of = options.greedy_best_of,
            "[whisper] 开始解码片段"
        );
        let started = Instant::now();

        state
            .full(params, &audio)
            .map_err(|e| anyhow!("识别失败: {e}"))?;

        let elapsed_ms = started.elapsed().as_millis();
        let n_segments = state.full_n_segments();

        // 取识别 / 锁定使用的语言短代码（"zh"/"en"/...）。
        // 不论 options.language 是显式指定还是 "auto" 检测，whisper.cpp 都会把
        // 实际生效的语言写入 state，由 full_lang_id_from_state 读出。
        let lang_id = state.full_lang_id_from_state();
        let lang = get_lang_str(lang_id).map(|s| s.to_string());

        let segs_guard = segments
            .lock()
            .map_err(|_| anyhow!("SRT segments lock poisoned"))?;

        tracing::debug!(
            offset_cs,
            elapsed_ms,
            n_segments,
            collected = segs_guard.len(),
            lang_id,
            lang = ?lang,
            "[whisper] 片段解码完成"
        );

        if n_segments == 0 && dur_s > 1.0 {
            tracing::warn!(
                "[whisper] 段数为 0：dur={:.1}s peak={:.4} rms={:.6}。\
                 若音频电平正常但耗时极短（<片长 1/100），多半是 GPU 后端跳过了 forward pass，\
                 检查 use_gpu / flash_attn / 解码策略组合。",
                dur_s,
                peak,
                rms
            );
        }

        Ok(WhisperTranscribeOutput {
            items: segs_guard.clone(),
            // 无段输出时不报告语言（多半是 0 段失败或纯静音，结果不可信）
            lang: if segs_guard.is_empty() { None } else { lang },
        })
    }
}

fn audio_peak_rms(audio: &[f32]) -> (f32, f64) {
    if audio.is_empty() {
        return (0.0, 0.0);
    }
    let mut peak = 0.0f32;
    let mut sum_sq = 0.0f64;
    for &x in audio {
        let ax = x.abs();
        if ax > peak {
            peak = ax;
        }
        sum_sq += (x as f64) * (x as f64);
    }
    let rms = (sum_sq / audio.len() as f64).sqrt();
    (peak, rms)
}

/// 兼容旧调用：默认 engine + 默认 options，仅返回文本段。
/// 如需获取检测到的语种，请直接使用 [`WhisperEngine::transcribe`]。
pub fn whisper_transcribe(
    samples_i16: &[i16],
    offset_cs: i64,
) -> Result<Vec<WhisperTranscribeItem>> {
    let engine = WhisperEngine::new()?;
    Ok(engine
        .transcribe(samples_i16, offset_cs, &WhisperOptions::default())?
        .items)
}
