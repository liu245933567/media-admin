use serde::{Deserialize, Serialize};
use typeshare::typeshare;
use utoipa::ToSchema;

/// whisper 语音识别结果 - 列表单项
#[derive(Clone)]
pub struct WhisperTranscribeItem {
    /// 开始时间戳（百毫秒，cs，1cs = 10ms）
    pub start_cs: i64,
    /// 结束时间戳（百毫秒，cs，1cs = 10ms）
    pub end_cs: i64,
    /// 语音识别文本（已 trim）
    pub text: String,
}

/// whisper 单次转写的整体输出（一段音频 → 多个文本段 + 整体语种）
#[derive(Default)]
pub struct WhisperTranscribeOutput {
    /// 文本段列表
    pub items: Vec<WhisperTranscribeItem>,
    /// 本次转写实际使用 / 自动检测到的语言短代码（如 `"zh"`、`"en"`）；
    /// 无法识别或无段输出时为 `None`。
    pub lang: Option<String>,
}

/// whisper 引擎运行时配置（影响模型加载，启动期决定）
#[typeshare]
#[derive(Clone, Hash, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
pub struct WhisperEngineConfig {
    /// 模型文件名
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
#[typeshare]
#[derive(Clone, Serialize, Deserialize, ToSchema)]
pub struct WhisperTranscribeConfig {
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

impl Default for WhisperTranscribeConfig {
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

/// VAD 配置
#[typeshare]
#[derive(Clone, Serialize, Deserialize, ToSchema)]
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
