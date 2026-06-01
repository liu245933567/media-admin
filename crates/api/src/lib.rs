use axum::Router;
use ma_service::AppConfig;
use ma_service::job::{TaskmillRuntime, spawn_taskmill_scheduler};
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::RwLock;
use tower_http::services::{ServeDir, ServeFile};

mod app_config_store;
mod error;
mod openapi;
mod routes;

#[cfg(feature = "openapi")]
pub use openapi::openapi_json;

fn build_router(app_state: AppState) -> Router<()> {
    Router::new()
        .nest("/api", routes::compose())
        .fallback_service(
            ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html")),
        )
        .with_state(app_state)
}

/// 启动 Axum（阻塞当前 async 上下文直至进程退出）。
pub async fn serve() -> anyhow::Result<()> {
    ma_utils::log::init_tracing();

    let listen = std::env::var("LISTEN").unwrap_or_else(|_| "0.0.0.0:4000".to_string());

    let listener = TcpListener::bind(&listen).await?;

    let app_config = Arc::new(RwLock::new(
        app_config_store::load_or_init_app_config().await?,
    ));

    let db = ma_db::connect().await?;
    let taskmill = TaskmillRuntime::setup(db.clone()).await?;
    spawn_taskmill_scheduler(&taskmill);

    let app_state = AppState {
        taskmill,
        app_config,
        db,
    };

    let app = build_router(app_state);

    tracing::info!("listening on {}", listen);

    axum::serve(listener, app.into_make_service()).await?;

    Ok(())
}

/// 绑定并开始监听，在后台运行 Axum，返回实际监听地址（用于桌面 WebView 加载同源前端与 `/api`）。
pub async fn spawn_server(listen: impl AsRef<str>) -> anyhow::Result<std::net::SocketAddr> {
    let listener = TcpListener::bind(listen.as_ref()).await?;
    let addr = listener.local_addr()?;

    let app_config = Arc::new(RwLock::new(
        app_config_store::load_or_init_app_config().await?,
    ));

    let db = ma_db::connect().await?;
    let taskmill = TaskmillRuntime::setup(db.clone()).await?;
    spawn_taskmill_scheduler(&taskmill);

    let app_state = AppState {
        taskmill,
        app_config,
        db,
    };
    let app = build_router(app_state);

    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app.into_make_service()).await {
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
    pub taskmill: TaskmillRuntime,
    pub app_config: Arc<RwLock<AppConfig>>,
    pub db: ma_db::SqlitePool,
}

type StateRouter = Router<AppState>;
