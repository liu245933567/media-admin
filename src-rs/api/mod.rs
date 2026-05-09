use axum::Router;
use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use sea_orm_migration::prelude::MigratorTrait;
use std::time::Duration;
use tokio::net::TcpListener;
use tower_http::services::{ServeDir, ServeFile};

use crate::{
    config::{SQLITE_DATA_DIR, SQLITE_DB_FILE},
    log::init_tracing,
    migration::Migrator,
    state::AppState,
};

mod middleware;
mod routes;

#[tokio::main]
pub async fn start() {
    init_tracing();

    let listen = std::env::var("LISTEN").unwrap_or_else(|_| "0.0.0.0:3000".to_string());

    let listener = TcpListener::bind(&listen).await.unwrap();

    let db = connect_db().await.unwrap();

    let app_state = AppState { db };

    let app = Router::new()
        .nest("/api", routes::compose())
        .layer(axum::middleware::from_fn(middleware::request_id))
        .fallback_service(
            ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html")),
        )
        .with_state(app_state);

    tracing::info!("listening on {}", &listen.to_string());

    axum::serve(listener, app).await.unwrap();
}

async fn connect_db() -> anyhow::Result<DatabaseConnection> {
    tokio::fs::create_dir_all(SQLITE_DATA_DIR).await?;

    let mut options = ConnectOptions::new(SQLITE_DB_FILE.to_owned());
    options
        .max_connections(10)
        .min_connections(1)
        .connect_timeout(Duration::from_secs(8))
        .acquire_timeout(Duration::from_secs(8))
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_secs(1800))
        .sqlx_logging(cfg!(debug_assertions));

    let db = Database::connect(options).await?;
    tracing::info!("connected sqlite database");

    Migrator::up(&db, None).await?;
    tracing::info!("sqlite database migrations completed");

    Ok(db)
}

type StateRouter = Router<AppState>;
