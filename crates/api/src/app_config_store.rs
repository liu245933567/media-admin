//! 从业务 SQLite 加载 / 持久化 [`AppConfig`]。

use anyhow::{Context, Result};
use ma_db::app_settings::{self, APP_CONFIG_KEY};
use ma_db::SqlitePool;
use ma_service::AppConfig;

/// 读取 JSON；无记录时写入 [`AppConfig::from_generate_defaults`] 并返回。
pub async fn load_or_init_app_config(pool: &SqlitePool) -> Result<AppConfig> {
    match app_settings::get_setting_value(pool, APP_CONFIG_KEY)
        .await
        .context("读取 app_settings")?
    {
        Some(json) => serde_json::from_str(&json).context("解析 app_config JSON 失败"),
        None => {
            let c = AppConfig::from_generate_defaults();
            persist_app_config(pool, &c)
                .await
                .context("写入默认 app_config")?;
            Ok(c)
        },
    }
}

/// 将当前配置写入 `app_settings`。
pub async fn persist_app_config(pool: &SqlitePool, config: &AppConfig) -> Result<()> {
    let json = serde_json::to_string(config).context("序列化 AppConfig")?;
    app_settings::upsert_setting_value(pool, APP_CONFIG_KEY, &json)
        .await
        .context("写入 app_settings")?;
    Ok(())
}
