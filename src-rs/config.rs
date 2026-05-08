use std::net::SocketAddr;

#[derive(Clone, Debug)]
pub struct Config {
    /// 服务监听地址
    pub listen: SocketAddr,
    /// 数据库连接 URL
    pub database_url: String,
    pub cors_origins: Vec<String>,
    /// `whisper-rs` 使用的 GGML 权重路径：可为单个 `.bin` / `.gguf` 文件，或存放该文件的目录。
    /// 不完整时会从 Hugging Face 拉取 `whisper_ggml_filename` 到该目录（目录不存在则创建）。
    pub whisper_model_path: String,
    /// Hugging Face 仓库 id（须包含 `whisper_ggml_filename`），默认 `ggerganov/whisper.cpp`。
    pub whisper_hf_repo: String,
    /// 仓库内 GGML 文件名，例如 `ggml-large-v3-turbo-q5_0.bin`（量化）或 `ggml-large-v3-turbo.bin`（全精度）。
    pub whisper_ggml_filename: String,
    pub whisper_device: String,
    /// 提示 whisper.cpp 行为：`flash` / `flash_attn` 子串会在启用 GPU 时尝试打开 flash attention。
    pub whisper_compute_type: String,
    /// Optional token for gated Hugging Face models (`HF_TOKEN`).
    pub hf_token: Option<String>,
    /// Root directory for Hugging Face hub cache used when downloading the model (`HF_HOME`-style layout).
    pub hf_cache_dir: Option<String>,
    /// If unset, `ffmpeg` must be on `PATH` unless auto-download succeeds.
    pub ffmpeg_path: Option<String>,
    /// When true and ffmpeg is not runnable, try downloading a static build (Windows zip supported).
    pub ffmpeg_auto_download: bool,
    /// Override URL for ffmpeg archive (zip on Windows).
    pub ffmpeg_download_url: Option<String>,
    /// Directory to extract downloaded ffmpeg under (default `tools/ffmpeg-dist` under cwd).
    pub ffmpeg_extract_dir: Option<String>,
    /// Select specific audio stream index when extracting audio from video.
    /// Maps to `ffmpeg -map 0:a:<index>`. Useful when the default selected track is silent.
    pub ffmpeg_audio_stream: Option<u8>,
    pub deepseek_api_key: String,
    pub deepseek_api_base: String,
    pub deepseek_model: String,

    /// Enable VAD-based trimming of silence before whisper decoding.
    pub whisper_vad_enable: bool,
    /// webrtcvad aggressiveness: 0 (least) ..= 3 (most). Higher trims more but risks cutting speech.
    pub whisper_vad_mode: u8,
    /// VAD frame size in ms. Must be 10/20/30 for webrtcvad.
    pub whisper_vad_frame_ms: u16,
    /// Merge adjacent speech segments with padding on both sides (ms).
    pub whisper_vad_padding_ms: u32,
    /// Drop speech segments shorter than this (ms).
    pub whisper_vad_min_speech_ms: u32,

    /// Enable ffmpeg denoise filter during audio extraction.
    pub ffmpeg_denoise_enable: bool,
    /// ffmpeg audio filter string (e.g. "afftdn=nf=-25" or "anlmdn=s=0.002:p=0.02").
    pub ffmpeg_denoise_filter: String,
}

impl Config {
    pub fn init() -> anyhow::Result<Self> {
        let host = std::env::var("SERVER_HOST").unwrap_or_else(|_| "127.0.0.1".into());
        let port: u16 = std::env::var("SERVER_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(3000);
        let listen: SocketAddr = format!("{host}:{port}").parse()?;

        let database_url = std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "sqlite://./subtitle_admin.db".to_string());

        let cors_origins = std::env::var("CORS_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:5173,http://127.0.0.1:5173".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let static_dir =
            std::env::var("SUBTITLE_ADMIN_STATIC_DIR").unwrap_or_else(|_| "static".into());
        let static_dir = static_dir.trim().to_string();
        let static_dir = if static_dir.is_empty() {
            "static".to_string()
        } else {
            static_dir
        };

        let whisper_model_path = std::env::var("WHISPER_MODEL_PATH")
            .or_else(|_| std::env::var("SUBTITLE_ADMIN_MODELS_DIR"))
            .unwrap_or_else(|_| format!("{}/models/whisper-large-v3-turbo", static_dir));

        let whisper_hf_repo = std::env::var("WHISPER_HF_REPO").unwrap_or_else(|_| {
            std::env::var("WHISPER_MODEL_URL")
                .ok()
                .filter(|s| !s.contains("://") && s.contains('/'))
                .unwrap_or_else(|| "ggerganov/whisper.cpp".to_string())
        });

        let whisper_ggml_filename = std::env::var("WHISPER_GGML_FILE")
            .unwrap_or_else(|_| "ggml-large-v3-turbo.bin".to_string());

        let whisper_device = std::env::var("WHISPER_DEVICE").unwrap_or_else(|_| "cpu".to_string());
        let whisper_compute_type =
            std::env::var("WHISPER_COMPUTE_TYPE").unwrap_or_else(|_| "default".to_string());

        let hf_token = std::env::var("HF_TOKEN")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let hf_cache_dir = std::env::var("SUBTITLE_ADMIN_HF_CACHE")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let ffmpeg_path = std::env::var("FFMPEG_PATH")
            .or_else(|_| std::env::var("SUBTITLE_ADMIN_FFMPEG_PATH"))
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let ffmpeg_auto_download = parse_bool_env("FFMPEG_AUTO_DOWNLOAD").unwrap_or(true);

        let ffmpeg_download_url = std::env::var("FFMPEG_DOWNLOAD_URL")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let ffmpeg_extract_dir = std::env::var("FFMPEG_EXTRACT_DIR")
            .or_else(|_| std::env::var("SUBTITLE_ADMIN_FFMPEG_DIR"))
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let ffmpeg_audio_stream: Option<u8> = std::env::var("FFMPEG_AUDIO_STREAM")
            .or_else(|_| std::env::var("SUBTITLE_ADMIN_FFMPEG_AUDIO_STREAM"))
            .ok()
            .and_then(|s| s.trim().parse().ok());

        let deepseek_api_key = std::env::var("DEEPSEEK_API_KEY").unwrap_or_default();
        let deepseek_api_base = std::env::var("DEEPSEEK_API_BASE")
            .unwrap_or_else(|_| "https://api.deepseek.com".to_string());
        let deepseek_model =
            std::env::var("DEEPSEEK_MODEL").unwrap_or_else(|_| "deepseek-v4-flash".to_string());

        let whisper_vad_enable = parse_bool_env("WHISPER_VAD_ENABLE").unwrap_or(false);
        let whisper_vad_mode: u8 = std::env::var("WHISPER_VAD_MODE")
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(2)
            .min(3);
        let whisper_vad_frame_ms: u16 = std::env::var("WHISPER_VAD_FRAME_MS")
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(30);
        let whisper_vad_padding_ms: u32 = std::env::var("WHISPER_VAD_PADDING_MS")
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(200);
        let whisper_vad_min_speech_ms: u32 = std::env::var("WHISPER_VAD_MIN_SPEECH_MS")
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(300);

        let ffmpeg_denoise_enable = parse_bool_env("FFMPEG_DENOISE_ENABLE").unwrap_or(false);
        let ffmpeg_denoise_filter = std::env::var("FFMPEG_DENOISE_FILTER").unwrap_or_else(|_| {
            // a conservative default that helps with steady noise
            "afftdn=nf=-25".to_string()
        });

        Ok(Config {
            listen,
            database_url,
            cors_origins,
            whisper_model_path,
            whisper_hf_repo,
            whisper_ggml_filename,
            whisper_device,
            whisper_compute_type,
            hf_token,
            hf_cache_dir,
            ffmpeg_path,
            ffmpeg_auto_download,
            ffmpeg_download_url,
            ffmpeg_extract_dir,
            ffmpeg_audio_stream,
            deepseek_api_key,
            deepseek_api_base,
            deepseek_model,

            whisper_vad_enable,
            whisper_vad_mode,
            whisper_vad_frame_ms,
            whisper_vad_padding_ms,
            whisper_vad_min_speech_ms,

            ffmpeg_denoise_enable,
            ffmpeg_denoise_filter,
        })
    }
}

fn parse_bool_env(key: &str) -> Option<bool> {
    std::env::var(key).ok().map(|s| {
        matches!(
            s.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

/// 模型目录
pub const MODELS_DIR: &'static str = "static/models";
/// ffmpeg 目录
pub const FFMPEG_DIR: &'static str = "static/tools/ffmpeg";
/// 临时 WAV 目录
pub const TEMP_WAV_DIR: &'static str = "static/temp/wav";
/// sqlite 数据库文件
pub const SQLITE_DB_FILE: &'static str = "static/data/media_admin.db";
