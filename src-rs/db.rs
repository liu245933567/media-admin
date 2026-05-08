use anyhow::Context;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

use crate::config::SQLITE_DB_FILE;

pub async fn connect_db() -> anyhow::Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(SQLITE_DB_FILE)
        .context("解析 DATABASE_URL")?
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .context("连接 SQLite 数据库")?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .context("执行数据库迁移")?;
    Ok(pool)
}
