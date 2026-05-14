use sqlx::FromRow;

#[derive(Clone, Debug, PartialEq, Eq, FromRow)]
pub struct SubtitleTask {
    pub task_id: i32,
    pub task_status: String,
    pub video_path: String,
    pub config_json: String,
    pub created_at: String,
    pub updated_at: String,
}
