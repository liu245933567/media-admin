mod config;
mod db;
mod error;
mod generation_job;
mod local_pipeline;
mod whisper_transcribe;
mod routes;
mod state;
mod xunlei;

use axum::http::{HeaderValue, Method};
use axum::routing::{get, post};
use axum::Router;
use routes::local_subtitles::{create_local_job, get_local_job, list_local_jobs};
use routes::subtitles::{download_subtitle, search_subtitles};
use state::AppState;
use std::sync::Arc;
use tokio::sync::Mutex;
use tower_http::cors::{AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::fmt::time::FormatTime;
use tracing_subscriber::EnvFilter;

struct LocalDateTime;

impl FormatTime for LocalDateTime {
    fn format_time(
        &self,
        w: &mut tracing_subscriber::fmt::format::Writer<'_>,
    ) -> std::fmt::Result {
        write!(
            w,
            "{}",
            chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
        )
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // `.env` is not read by Rust automatically; load it before tracing reads `RUST_LOG`.
    let _ = dotenvy::dotenv();

    let env_filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        // 未设置 `RUST_LOG` 时的默认级别：本 crate debug，HTTP 访问 info，SQL 语句 warn。
        EnvFilter::new("info,backend=debug,tower_http=info,sqlx::query=warn")
    });

    tracing_subscriber::fmt()
        .with_timer(LocalDateTime)
        .with_env_filter(env_filter)
        .init();

    let config = Arc::new(config::Config::from_env()?);
    let pool = db::connect(&config.database_url).await?;
    let xunlei = Arc::new(xunlei::ThunderSubtitleClient::new(
        config.xunlei_subtitle_base.clone(),
    )?);

    let origins: Vec<HeaderValue> = config
        .cors_origins
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
        .allow_headers(tower_http::cors::Any);

    let state = AppState {
        pool: pool.clone(),
        xunlei: xunlei.clone(),
        config: config.clone(),
        model_download_lock: Arc::new(Mutex::new(())),
    };

    let api = Router::new()
        .route("/subtitles/search", post(search_subtitles))
        .route("/subtitles/download", post(download_subtitle))
        .route("/local-subtitles/jobs", post(create_local_job).get(list_local_jobs))
        .route("/local-subtitles/jobs/{id}", get(get_local_job))
        .with_state(state);

    let app = Router::new()
        .route("/health", get(health))
        .nest("/api", api)
        .layer(cors)
        .layer(TraceLayer::new_for_http());

    tracing::info!(
        listen = %config.listen,
        database_url = %redact_credentials(&config.database_url),
        whisper_model_path = %config.whisper_model_path,
        whisper_hf_repo = %config.whisper_hf_repo,
        "subtitle-admin backend starting"
    );
    let listener = tokio::net::TcpListener::bind(config.listen).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

async fn health() -> &'static str {
    "ok"
}

/// 避免在启动日志中打印带口令的数据库 URL。
fn redact_credentials(url: &str) -> String {
    if let Some(idx) = url.find("://") {
        let after_scheme = &url[idx + 3..];
        if let Some(at_rel) = after_scheme.find('@') {
            let scheme = &url[..idx];
            let host_and_path = &after_scheme[at_rel + 1..];
            return format!("{scheme}://***@{host_and_path}");
        }
    }
    url.to_string()
}
