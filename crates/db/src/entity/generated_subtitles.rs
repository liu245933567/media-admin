use sqlx::FromRow;

#[derive(Clone, Debug, PartialEq, Eq, FromRow)]
pub struct GeneratedSubtitle {
    pub subtitle_id: i32,
    pub task_id: Option<i32>,
    pub subtitle_path: String,
    pub created_at: String,
}
