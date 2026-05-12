use axum::Router;
use ma_service::setup_download::SetupDownloadState;
use ma_service::subtitle_worker::{SubtitleTaskQueue, spawn_subtitle_task_worker};
use tokio::net::TcpListener;
use tower_http::services::{ServeDir, ServeFile};

use sea_orm::DatabaseConnection;

mod error;
mod routes;

fn build_router(app_state: AppState) -> Router<()> {
    Router::new()
        .nest("/api", routes::compose())
        .fallback_service(
            ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html")),
        )
        .with_state(app_state)
}

fn build_setup_download_state() -> anyhow::Result<SetupDownloadState> {
    let client = reqwest::Client::builder()
        .user_agent("media-admin/0.1")
        .build()
        .map_err(|e| anyhow::anyhow!("构建 HTTP 客户端失败: {e}"))?;
    Ok(SetupDownloadState::new(client))
}

/// 启动 Axum（阻塞当前 async 上下文直至进程退出）。
pub async fn serve() -> anyhow::Result<()> {
    ma_utils::log::init_tracing();

    let listen = std::env::var("LISTEN").unwrap_or_else(|_| "0.0.0.0:3000".to_string());

    let listener = TcpListener::bind(&listen).await?;

    let db = ma_db::connect().await?;

    let subtitle_task_queue = SubtitleTaskQueue::new();
    spawn_subtitle_task_worker(db.clone(), subtitle_task_queue.clone());

    let setup_download = build_setup_download_state()?;

    let app_state = AppState {
        db,
        subtitle_task_queue,
        setup_download,
    };

    let app = build_router(app_state);

    tracing::info!("listening on {}", listen);

    axum::serve(listener, app).await?;

    Ok(())
}

/// 绑定并开始监听，在后台运行 Axum，返回实际监听地址（用于桌面 WebView 加载同源前端与 `/api`）。
pub async fn spawn_server(listen: impl AsRef<str>) -> anyhow::Result<std::net::SocketAddr> {
    let listener = TcpListener::bind(listen.as_ref()).await?;
    let addr = listener.local_addr()?;

    let db = ma_db::connect().await?;
    let subtitle_task_queue = SubtitleTaskQueue::new();

    spawn_subtitle_task_worker(db.clone(), subtitle_task_queue.clone());

    let setup_download = build_setup_download_state()?;

    let app_state = AppState {
        db,
        subtitle_task_queue,
        setup_download,
    };
    let app = build_router(app_state);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app).await {
            tracing::error!(?e, "axum server stopped");
        }
    });

    Ok(addr)
}

#[tokio::main]
pub async fn start() {
    if let Err(e) = serve().await {
        tracing::error!(?e, "server failed");
        std::process::exit(1);
    }
}

#[derive(Clone)]
pub(crate) struct AppState {
    pub db: DatabaseConnection,
    pub subtitle_task_queue: SubtitleTaskQueue,
    pub setup_download: SetupDownloadState,
}

type StateRouter = Router<AppState>;
