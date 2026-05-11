use axum::Router;
use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use sea_orm_migration::prelude::MigratorTrait;
use std::time::Duration;
use tokio::net::TcpListener;
use tower_http::services::{ServeDir, ServeFile};

use crate::{
    core::subtitle_worker::{spawn_subtitle_task_worker, SubtitleTaskQueue},
    log::init_tracing,
    migration::Migrator,
    state::AppState,
};

use ma_utils::config::{get_app_data_dir, get_sqlite_connect_url, get_sqlx_logging};

mod config;
mod core;
mod entity;
mod error;
pub mod log;
mod middleware;
mod migration;
mod routes;
mod state;

fn build_router(app_state: AppState) -> Router<()> {
    Router::new()
        .nest("/api", routes::compose())
        .layer(axum::middleware::from_fn(middleware::request_id))
        .fallback_service(
            ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html")),
        )
        .with_state(app_state)
}

/// 启动 Axum（阻塞当前 async 上下文直至进程退出）。
pub async fn serve() -> anyhow::Result<()> {
    init_tracing();

    let listen = std::env::var("LISTEN").unwrap_or_else(|_| "0.0.0.0:3000".to_string());

    let listener = TcpListener::bind(&listen).await?;

    let db = connect_db().await?;

    let subtitle_task_queue = SubtitleTaskQueue::new();
    spawn_subtitle_task_worker(db.clone(), subtitle_task_queue.clone());

    let app_state = AppState {
        db,
        subtitle_task_queue,
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

    let db = connect_db().await?;
    let subtitle_task_queue = SubtitleTaskQueue::new();
    spawn_subtitle_task_worker(db.clone(), subtitle_task_queue.clone());

    let app_state = AppState {
        db,
        subtitle_task_queue,
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

async fn connect_db() -> anyhow::Result<DatabaseConnection> {
    tokio::fs::create_dir_all(get_app_data_dir()?).await?;

    let mut options = ConnectOptions::new(get_sqlite_connect_url()?);

    options
        .max_connections(10)
        .min_connections(1)
        .connect_timeout(Duration::from_secs(8))
        .acquire_timeout(Duration::from_secs(8))
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_secs(1800))
        .sqlx_logging(get_sqlx_logging());

    let db = Database::connect(options).await?;
    tracing::info!("connected sqlite database");

    Migrator::up(&db, None).await?;
    tracing::info!("sqlite database migrations completed");

    Ok(db)
}

type StateRouter = Router<AppState>;
