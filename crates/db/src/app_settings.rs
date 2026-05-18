//! 业务库 `app_settings` 表读写（键值 JSON 文本）。

use anyhow::{Context, Result};
use sqlx::SqlitePool;

/// 全局应用配置在库中的键名。
pub const APP_CONFIG_KEY: &str = "app_config";

/// 读取原始 JSON 文本；无记录时返回 `Ok(None)`。
pub async fn get_setting_value(pool: &SqlitePool, key: &str) -> Result<Option<String>> {
    let row = sqlx::query_scalar::<_, String>("SELECT value FROM app_settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await
        .with_context(|| format!("读取 app_settings[{key}] 失败"))?;
    Ok(row)
}

/// 插入或更新一条设置。
pub async fn upsert_setting_value(pool: &SqlitePool, key: &str, value: &str) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO app_settings (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        "#,
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await
    .with_context(|| format!("写入 app_settings[{key}] 失败"))?;
    Ok(())
}
