use anyhow::Context;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::str::FromStr;

pub async fn connect(database_url: &str) -> anyhow::Result<SqlitePool> {
    let options = SqliteConnectOptions::from_str(database_url)
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
