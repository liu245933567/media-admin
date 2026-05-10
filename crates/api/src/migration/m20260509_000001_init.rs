use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(SubtitleTask::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SubtitleTask::TaskId)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(SubtitleTask::TaskStatus).string().not_null())
                    .col(ColumnDef::new(SubtitleTask::VideoPath).string().not_null())
                    .col(ColumnDef::new(SubtitleTask::CreatedAt).string().not_null())
                    .col(ColumnDef::new(SubtitleTask::UpdatedAt).string().not_null())
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(SubtitleTaskRecord::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(SubtitleTaskRecord::RecordId)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(
                        ColumnDef::new(SubtitleTaskRecord::TaskId)
                            .integer()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SubtitleTaskRecord::RecordStatus)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SubtitleTaskRecord::RecordDesc)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SubtitleTaskRecord::RecordDetail)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SubtitleTaskRecord::CreatedAt)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(SubtitleTaskRecord::UpdatedAt)
                            .string()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_table(
                Table::create()
                    .table(GeneratedSubtitles::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(GeneratedSubtitles::SubtitleId)
                            .integer()
                            .not_null()
                            .auto_increment()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(GeneratedSubtitles::TaskId).integer())
                    .col(
                        ColumnDef::new(GeneratedSubtitles::SubtitlePath)
                            .string()
                            .not_null(),
                    )
                    .col(
                        ColumnDef::new(GeneratedSubtitles::CreatedAt)
                            .string()
                            .not_null(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(
                Table::drop()
                    .table(GeneratedSubtitles::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(
                Table::drop()
                    .table(SubtitleTaskRecord::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(
                Table::drop()
                    .table(SubtitleTask::Table)
                    .if_exists()
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum SubtitleTask {
    Table,
    TaskId,
    TaskStatus,
    VideoPath,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum SubtitleTaskRecord {
    Table,
    RecordId,
    TaskId,
    RecordStatus,
    RecordDesc,
    RecordDetail,
    CreatedAt,
    UpdatedAt,
}

#[derive(DeriveIden)]
enum GeneratedSubtitles {
    Table,
    SubtitleId,
    TaskId,
    SubtitlePath,
    CreatedAt,
}
