use sqlx::FromRow;

#[derive(Clone, Debug, PartialEq, Eq, FromRow)]
pub struct SubtitleTranslateTask {
    pub task_id: i32,
    pub task_status: String,
    pub source_srt_path: String,
    pub config_json: String,
    pub created_at: String,
    pub updated_at: String,
}
