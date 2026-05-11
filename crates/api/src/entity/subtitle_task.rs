use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "subtitle_task")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub task_id: i32,
    pub task_status: String,
    pub video_path: String,
    pub config_json: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
