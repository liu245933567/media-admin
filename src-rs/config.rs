use std::net::SocketAddr;

#[derive(Clone, Debug)]
pub struct Config {
    pub listen: SocketAddr,
    pub database_url: String,
    pub xunlei_subtitle_base: String,
    pub cors_origins: Vec<String>,
    /// 目录须最终能解析到同时含有 `config.json` 与 `model.bin` 的 CT2 快照根目录（可与权重同级，或在下一级/下两级子目录）。
    /// 不完整时会从 Hugging Face 拉取；`WHISPER_MODEL_PATH` 请指向你实际放模型的文件夹（例如 `dist/faster-whisper-large-v3`）。
    pub whisper_model_path: String,
    /// Hugging Face model repo id (CTranslate2 `faster-whisper` layout), e.g. `Systran/faster-whisper-large-v3`.
    pub whisper_hf_repo: String,
    pub whisper_device: String,
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
    pub deepseek_api_key: String,
    pub deepseek_api_base: String,
    pub deepseek_model: String,
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let host = std::env::var("SUBTITLE_ADMIN_HOST").unwrap_or_else(|_| "127.0.0.1".into());
        let port: u16 = std::env::var("SUBTITLE_ADMIN_PORT")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(3000);
        let listen: SocketAddr = format!("{host}:{port}").parse()?;

        let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
            "sqlite://./subtitle_admin.db".to_string()
        });

        let xunlei_subtitle_base = std::env::var("XUNLEI_SUBTITLE_BASE").unwrap_or_else(|_| {
            "https://api-shoulei-ssl.xunlei.com/oracle/subtitle".into()
        });

        let cors_origins = std::env::var("SUBTITLE_ADMIN_CORS_ORIGINS")
            .unwrap_or_else(|_| "http://localhost:5173,http://127.0.0.1:5173".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        let whisper_model_path = std::env::var("WHISPER_MODEL_PATH").unwrap_or_else(|_| {
            "models/faster-whisper-large-v3".to_string()
        });

        let whisper_hf_repo = std::env::var("WHISPER_HF_REPO").unwrap_or_else(|_| {
            std::env::var("WHISPER_MODEL_URL")
                .ok()
                .filter(|s| !s.contains("://") && s.contains('/'))
                .unwrap_or_else(|| "Systran/faster-whisper-large-v3".to_string())
        });

        let whisper_device = std::env::var("WHISPER_DEVICE").unwrap_or_else(|_| "cpu".to_string());
        let whisper_compute_type =
            std::env::var("WHISPER_COMPUTE_TYPE").unwrap_or_else(|_| "int8".to_string());

        let hf_token = std::env::var("HF_TOKEN")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let hf_cache_dir = std::env::var("SUBTITLE_ADMIN_HF_CACHE")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let ffmpeg_path = std::env::var("FFMPEG_PATH")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let ffmpeg_auto_download = parse_bool_env("FFMPEG_AUTO_DOWNLOAD").unwrap_or(true);

        let ffmpeg_download_url = std::env::var("FFMPEG_DOWNLOAD_URL")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let ffmpeg_extract_dir = std::env::var("FFMPEG_EXTRACT_DIR")
            .ok()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        let deepseek_api_key = std::env::var("DEEPSEEK_API_KEY").unwrap_or_default();
        let deepseek_api_base = std::env::var("DEEPSEEK_API_BASE").unwrap_or_else(|_| {
            "https://api.deepseek.com".to_string()
        });
        let deepseek_model = std::env::var("DEEPSEEK_MODEL")
            .unwrap_or_else(|_| "deepseek-v4-flash".to_string());

        Ok(Config {
            listen,
            database_url,
            xunlei_subtitle_base,
            cors_origins,
            whisper_model_path,
            whisper_hf_repo,
            whisper_device,
            whisper_compute_type,
            hf_token,
            hf_cache_dir,
            ffmpeg_path,
            ffmpeg_auto_download,
            ffmpeg_download_url,
            ffmpeg_extract_dir,
            deepseek_api_key,
            deepseek_api_base,
            deepseek_model,
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
