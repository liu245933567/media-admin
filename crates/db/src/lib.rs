use std::time::Duration;

use ma_utils::config::{get_app_data_dir, get_sqlite_connect_url, get_sqlx_logging};
use sea_orm::{ConnectOptions, Database, DatabaseConnection};
use sea_orm_migration::prelude::MigratorTrait;

pub mod entity;
mod migration;

use migration::Migrator;

pub async fn connect() -> anyhow::Result<DatabaseConnection> {
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


