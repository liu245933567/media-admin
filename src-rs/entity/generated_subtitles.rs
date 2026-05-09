use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "generated_subtitles")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub subtitle_id: i32,
    pub task_id: Option<i32>,
    pub subtitle_path: String,
    pub created_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
