use sea_orm::DatabaseConnection;

use crate::core::subtitle_worker::SubtitleTaskQueue;

#[derive(Clone)]
pub struct AppState {
    pub db: DatabaseConnection,
    pub subtitle_task_queue: SubtitleTaskQueue,
}
