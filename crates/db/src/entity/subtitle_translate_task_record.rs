use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel)]
#[sea_orm(table_name = "subtitle_translate_task_record")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub record_id: i32,
    pub task_id: i32,
    pub record_status: String,
    pub record_desc: String,
    pub record_detail: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
