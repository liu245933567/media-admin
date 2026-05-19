use std::{str::FromStr, time::Duration};

use ma_utils::config::{get_app_data_dir, get_sqlite_connect_url, get_sqlx_logging};
use sqlx::{
    ConnectOptions,
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
};

pub mod entity;

pub use sqlx::SqlitePool;

pub async fn connect() -> anyhow::Result<SqlitePool> {
    tokio::fs::create_dir_all(get_app_data_dir()?).await?;

    let url = get_sqlite_connect_url()?;
    let mut opts = SqliteConnectOptions::from_str(&url).map_err(|e| anyhow::anyhow!("{e}"))?;
    if get_sqlx_logging() {
        opts = opts.log_statements(log::LevelFilter::Debug);
    } else {
        opts = opts.disable_statement_logging();
    }

    let pool = SqlitePoolOptions::new()
        .max_connections(10)
        .min_connections(1)
        .acquire_timeout(Duration::from_secs(8))
        .idle_timeout(Duration::from_secs(600))
        .max_lifetime(Duration::from_secs(1800))
        .connect_with(opts)
        .await?;
    tracing::info!("connected sqlite database");

    sqlx::migrate!("./migrations").run(&pool).await?;
    tracing::info!("sqlite database migrations completed");

    Ok(pool)
}
