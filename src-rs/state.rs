use crate::config::Config;
use crate::xunlei::ThunderSubtitleClient;
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::Mutex;

#[derive(Clone)]
pub struct AppState {
    pub pool: SqlitePool,
    pub xunlei: Arc<ThunderSubtitleClient>,
    pub config: Arc<Config>,
    pub model_download_lock: Arc<Mutex<()>>,
}
