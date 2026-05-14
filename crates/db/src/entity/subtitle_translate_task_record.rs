use sqlx::FromRow;

#[derive(Clone, Debug, PartialEq, Eq, FromRow)]
pub struct SubtitleTranslateTaskRecord {
    pub record_id: i32,
    pub task_id: i32,
    pub record_status: String,
    pub record_desc: String,
    pub record_detail: String,
    pub created_at: String,
    pub updated_at: String,
}
