//! 本地媒体资源目录与扫描结果维护。

use std::{
    collections::HashSet,
    ffi::OsStr,
    path::{Path, PathBuf},
    time::SystemTime,
};

use anyhow::{Context, Result, bail};
use chrono::{DateTime, Utc};
use ma_db::SqlitePool;
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, QueryBuilder, Sqlite};
use taskmill::SubmitOutcome;
use typeshare::{I54, U53, typeshare};
use utoipa::{IntoParams, ToSchema};

use crate::{
    job::{MediaLibraryScanTask, TaskmillRuntime},
    media_paths::{is_subtitle_file, is_supported_media_file, media_file_type},
};

#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
/// 媒体文件类型。
pub enum MediaFileType {
    Video,
    Subtitle,
}

impl MediaFileType {
    /// 返回数据库内保存的稳定字符串。
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Video => "video",
            Self::Subtitle => "subtitle",
        }
    }

    /// 从数据库字符串恢复媒体文件类型。
    pub fn from_db(value: &str) -> Self {
        match value {
            "subtitle" => Self::Subtitle,
            _ => Self::Video,
        }
    }
}

#[typeshare]
#[derive(Debug, Deserialize, ToSchema)]
/// 新增媒体资源根目录请求。
pub struct MediaRootCreateReq {
    pub path: String,
    pub name: Option<String>,
}

#[typeshare]
#[derive(Debug, Serialize, ToSchema)]
/// 媒体资源根目录列表行。
pub struct MediaRootRow {
    #[schema(value_type = i64)]
    pub id: I54,
    pub path: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_scanned_at: Option<String>,
}

#[typeshare]
#[derive(Debug, Serialize, ToSchema)]
/// 视频拥有的字幕文件列表行。
pub struct MediaSubtitleRow {
    #[schema(value_type = i64)]
    pub id: I54,
    pub file_name: String,
    pub file_path: String,
    #[schema(value_type = u64)]
    pub file_size: U53,
    pub modified_at: String,
    pub scanned_at: String,
}

#[typeshare]
#[derive(Debug, Serialize, ToSchema)]
/// 媒体库视频列表行。
pub struct MediaVideoRow {
    #[schema(value_type = i64)]
    pub id: I54,
    #[schema(value_type = i64)]
    pub root_id: I54,
    pub file_name: String,
    pub file_path: String,
    #[schema(value_type = u64)]
    pub file_size: U53,
    pub modified_at: String,
    pub scanned_at: String,
    pub subtitle_count: u32,
    pub subtitles: Vec<MediaSubtitleRow>,
}

#[typeshare]
#[derive(Debug, Deserialize, IntoParams, ToSchema)]
/// 媒体库视频分页查询条件。
pub struct MediaVideosQuery {
    #[param(value_type = Option<i64>)]
    #[schema(value_type = i64)]
    pub root_id: Option<I54>,
    pub q: Option<String>,
    pub has_subtitle: Option<bool>,
    pub current: Option<i32>,
    pub page_size: Option<i32>,
}

#[typeshare]
#[derive(Debug, Serialize, ToSchema)]
/// 媒体库视频分页查询结果。
pub struct MediaVideosPageRes {
    pub data: Vec<MediaVideoRow>,
    #[schema(value_type = i64)]
    pub total: I54,
}

#[typeshare]
#[derive(Debug, Deserialize, ToSchema)]
/// 删除媒体库视频请求。
pub struct MediaVideoDeleteReq {
    pub video_paths: Vec<String>,
}

#[typeshare]
#[derive(Debug, Serialize, ToSchema)]
/// 删除媒体库视频结果摘要。
pub struct MediaVideoDeleteRes {
    pub deleted_videos: u32,
    pub deleted_subtitles: u32,
}

#[derive(Debug, FromRow)]
/// 数据库中的媒体资源根目录记录。
struct MediaRootRecord {
    id: i64,
    path: String,
    name: String,
    created_at: String,
    updated_at: String,
    last_scanned_at: Option<String>,
}

#[derive(Debug, FromRow)]
/// 数据库中的媒体文件记录。
struct MediaFileRecord {
    id: i64,
    root_id: i64,
    file_name: String,
    file_path: String,
    file_size: i64,
    modified_at: String,
    scanned_at: String,
}

#[typeshare]
#[derive(Debug, Serialize, ToSchema)]
/// 媒体库扫描结果摘要。
pub struct MediaLibraryScanRes {
    pub scanned: u32,
    pub videos: u32,
    pub subtitles: u32,
    pub removed: u32,
}

/// 已校验的媒体资源目录（媒体根目录或其子目录）。
#[derive(Debug, Clone)]
pub struct MediaResolvedChildDir {
    pub root_id: i64,
    pub folder_path: String,
}

/// 列出已维护的媒体资源根目录。
pub async fn list_media_roots(pool: &SqlitePool) -> Result<Vec<MediaRootRow>> {
    let rows = sqlx::query_as::<_, MediaRootRecord>(
        r#"
        SELECT id, path, name, created_at, updated_at, last_scanned_at
        FROM media_resource_roots
        ORDER BY path ASC
        "#,
    )
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(media_root_to_api).collect()
}

/// 新增媒体资源根目录，要求根目录之间不能互相包含。
pub async fn create_media_root(pool: &SqlitePool, req: MediaRootCreateReq) -> Result<MediaRootRow> {
    let normalized = normalize_existing_dir(&req.path).await?;
    let name = req
        .name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| default_root_name(&normalized.display_path));

    ensure_not_overlapping(pool, &normalized.real_path, None).await?;

    let path = normalized.display_path.to_string_lossy().to_string();
    let row = sqlx::query_as::<_, MediaRootRecord>(
        r#"
        INSERT INTO media_resource_roots (path, name)
        VALUES (?1, ?2)
        RETURNING id, path, name, created_at, updated_at, last_scanned_at
        "#,
    )
    .bind(path)
    .bind(name)
    .fetch_one(pool)
    .await
    .context("保存媒体资源目录失败")?;

    media_root_to_api(row)
}

/// 删除媒体资源根目录及其扫描文件。
pub async fn delete_media_root(pool: &SqlitePool, id: i64) -> Result<bool> {
    let mut tx = pool.begin().await?;
    sqlx::query("DELETE FROM media_files WHERE root_id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    let affected = sqlx::query("DELETE FROM media_resource_roots WHERE id = ?1")
        .bind(id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    tx.commit().await?;
    Ok(affected > 0)
}

/// 提交媒体库扫描任务。
pub async fn enqueue_media_library_scan(
    pool: &SqlitePool,
    runtime: &TaskmillRuntime,
    root_id: i64,
) -> Result<SubmitOutcome> {
    let root = find_media_root(pool, root_id).await?;
    runtime
        .enqueue_media_library_scan(MediaLibraryScanTask {
            root_id: i54(root_id, "媒体资源目录 id 超出 JS 安全整数范围")?,
            root_path: root.path,
        })
        .await
}

/// 校验文件夹属于已配置媒体根目录或其子目录。
pub async fn resolve_media_child_dir(
    pool: &SqlitePool,
    folder_path: &str,
) -> Result<MediaResolvedChildDir> {
    let normalized = normalize_existing_dir(folder_path).await?;
    let roots = list_media_roots(pool).await?;

    for root in roots {
        let root_path = PathBuf::from(&root.path);
        let root_real = tokio::fs::canonicalize(&root_path)
            .await
            .unwrap_or_else(|_| root_path.clone());

        if normalized.real_path == root_real || normalized.real_path.starts_with(&root_real) {
            return Ok(MediaResolvedChildDir {
                root_id: i64::from(root.id),
                folder_path: normalized.display_path.to_string_lossy().to_string(),
            });
        }
    }

    bail!("文件夹必须是已配置的媒体资源目录或其子目录")
}

/// 查询扫描入库的视频文件，并附带同目录匹配的字幕文件。
pub async fn list_media_videos(
    pool: &SqlitePool,
    q: MediaVideosQuery,
) -> Result<MediaVideosPageRes> {
    let current = q.current.unwrap_or(1).max(1);
    let page_size = q.page_size.unwrap_or(20).clamp(1, 200);
    let offset = (current - 1) * page_size;

    let keyword =
        q.q.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| format!("%{s}%"));
    let has_subtitle = q.has_subtitle;

    let mut count_builder = QueryBuilder::<Sqlite>::new("SELECT COUNT(*) FROM media_files");
    let root_id = q.root_id.map(i64::from);

    if let Some(has_subtitle) = has_subtitle {
        let rows = select_media_video_records(pool, root_id, keyword.as_deref(), None).await?;
        let subtitle_rows = subtitle_records_for_videos(pool, &rows).await?;
        let filtered = rows
            .into_iter()
            .map(|row| media_video_to_api(row, &subtitle_rows))
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .filter(|row| (row.subtitle_count > 0) == has_subtitle)
            .collect::<Vec<_>>();
        let total = filtered.len();
        let data = filtered
            .into_iter()
            .skip(usize::try_from(offset).unwrap_or(0))
            .take(usize::try_from(page_size).unwrap_or(20))
            .collect();

        return Ok(MediaVideosPageRes {
            data,
            total: i54(
                i64::try_from(total).context("媒体文件数量超出 SQLite INTEGER 范围")?,
                "媒体文件数量超出 JS 安全整数范围",
            )?,
        });
    }

    push_media_file_filters(
        &mut count_builder,
        root_id,
        Some(MediaFileType::Video.as_str()),
        keyword.as_deref(),
    );
    let total: i64 = count_builder.build_query_scalar().fetch_one(pool).await?;

    let rows =
        select_media_video_records(pool, root_id, keyword.as_deref(), Some((page_size, offset)))
            .await?;
    let subtitle_rows = subtitle_records_for_videos(pool, &rows).await?;
    let data = rows
        .into_iter()
        .map(|row| media_video_to_api(row, &subtitle_rows))
        .collect::<Result<Vec<_>>>()?;

    Ok(MediaVideosPageRes {
        data,
        total: i54(total, "媒体文件数量超出 JS 安全整数范围")?,
    })
}

/// 查询指定目录下扫描入库的视频文件，并附带同目录匹配的字幕文件。
pub async fn list_media_videos_under_dir(
    pool: &SqlitePool,
    root_id: i64,
    dir_path: &str,
) -> Result<Vec<MediaVideoRow>> {
    let dir = PathBuf::from(dir_path);
    if !dir.is_absolute() {
        bail!("媒体资源路径必须为绝对路径");
    }
    let prefix = scan_dir_prefix(&dir);
    let pattern = format!("{}%", escape_sqlite_like(&prefix));

    let rows = sqlx::query_as::<_, MediaFileRecord>(
        r#"
        SELECT id, root_id, file_name, file_path, file_size, modified_at, scanned_at
        FROM media_files
        WHERE root_id = ?1
          AND file_type = ?2
          AND file_path LIKE ?3 ESCAPE '\'
        ORDER BY file_path ASC
        "#,
    )
    .bind(root_id)
    .bind(MediaFileType::Video.as_str())
    .bind(pattern)
    .fetch_all(pool)
    .await?;

    let subtitle_rows = subtitle_records_for_videos(pool, &rows).await?;
    rows.into_iter()
        .map(|row| media_video_to_api(row, &subtitle_rows))
        .collect()
}

/// 查询视频媒体文件记录，可按分页参数限制返回范围。
async fn select_media_video_records(
    pool: &SqlitePool,
    root_id: Option<i64>,
    keyword: Option<&str>,
    page: Option<(i32, i32)>,
) -> Result<Vec<MediaFileRecord>> {
    let mut rows_builder = QueryBuilder::<Sqlite>::new(
        r#"
        SELECT id, root_id, file_name, file_path, file_size, modified_at, scanned_at
        FROM media_files
        "#,
    );
    push_media_file_filters(
        &mut rows_builder,
        root_id,
        Some(MediaFileType::Video.as_str()),
        keyword,
    );
    rows_builder.push(" ORDER BY file_path ASC");
    if let Some((page_size, offset)) = page {
        rows_builder.push(" LIMIT ");
        rows_builder.push_bind(page_size);
        rows_builder.push(" OFFSET ");
        rows_builder.push_bind(offset);
    }

    rows_builder
        .build_query_as::<MediaFileRecord>()
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

/// 删除视频文件，并同步删除数据库中与视频匹配的字幕文件记录和磁盘文件。
pub async fn delete_media_videos(
    pool: &SqlitePool,
    req: MediaVideoDeleteReq,
) -> Result<MediaVideoDeleteRes> {
    if req.video_paths.is_empty() {
        bail!("video_paths 不能为空");
    }

    let mut deleted_videos = 0_u32;
    let mut deleted_subtitles = 0_u32;

    for raw_path in req.video_paths {
        let video_path = raw_path.trim();
        if video_path.is_empty() {
            continue;
        }

        let video = find_video_by_path(pool, video_path).await?;
        let subtitles = subtitle_records_for_videos(pool, std::slice::from_ref(&video)).await?;
        let matched_subtitles = subtitles
            .into_iter()
            .filter(|subtitle| subtitle_matches_video(&video.file_path, &subtitle.file_path))
            .collect::<Vec<_>>();

        for subtitle in &matched_subtitles {
            remove_file_if_exists(&subtitle.file_path).await?;
        }
        remove_file_if_exists(&video.file_path).await?;

        let mut tx = pool.begin().await?;
        for subtitle in &matched_subtitles {
            sqlx::query("DELETE FROM media_files WHERE id = ?1")
                .bind(subtitle.id)
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query("DELETE FROM media_files WHERE id = ?1")
            .bind(video.id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;

        deleted_videos = deleted_videos.saturating_add(1);
        deleted_subtitles = deleted_subtitles
            .saturating_add(u32::try_from(matched_subtitles.len()).unwrap_or(u32::MAX));
    }

    Ok(MediaVideoDeleteRes {
        deleted_videos,
        deleted_subtitles,
    })
}

/// 扫描指定媒体资源根目录，并将视频/字幕文件写入数据库。
pub async fn scan_media_root(
    pool: &SqlitePool,
    root_id: i64,
    root_path: &str,
) -> Result<MediaLibraryScanRes> {
    scan_media_path(pool, root_id, root_path, ScanCleanupScope::Root).await
}

/// 扫描指定媒体资源子目录，并只更新该子目录范围内的数据库记录。
pub async fn scan_media_dir(
    pool: &SqlitePool,
    root_id: i64,
    dir_path: &str,
) -> Result<MediaLibraryScanRes> {
    scan_media_path(pool, root_id, dir_path, ScanCleanupScope::Dir).await
}

enum ScanCleanupScope {
    Root,
    Dir,
}

async fn scan_media_path(
    pool: &SqlitePool,
    root_id: i64,
    root_path: &str,
    cleanup_scope: ScanCleanupScope,
) -> Result<MediaLibraryScanRes> {
    let root = PathBuf::from(root_path);
    if !root.is_absolute() {
        bail!("媒体资源路径必须为绝对路径");
    }
    if !tokio::fs::try_exists(&root).await? {
        bail!("媒体资源路径不存在");
    }
    if !tokio::fs::metadata(&root).await?.is_dir() {
        bail!("媒体资源路径必须为目录");
    }

    let scanned_at = Utc::now().to_rfc3339();
    let mut files = Vec::new();
    let mut videos = 0_u32;
    let mut subtitles = 0_u32;
    let mut seen_paths = HashSet::new();

    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        let mut rd = match tokio::fs::read_dir(&dir).await {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(path = %dir.display(), error = %e, "读取媒体目录失败，已跳过");
                continue;
            }
        };

        while let Ok(Some(ent)) = rd.next_entry().await {
            let child = ent.path();
            let md = match ent.metadata().await {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!(path = %child.display(), error = %e, "读取媒体文件元数据失败，已跳过");
                    continue;
                }
            };

            if md.is_dir() {
                stack.push(child);
                continue;
            }
            if !md.is_file() || !is_supported_media_file(&child) {
                continue;
            }

            let file_type = match media_file_type(&child) {
                Some(v) => v,
                None => continue,
            };
            let Some(file_name) = file_name_string(&child) else {
                continue;
            };
            let file_path = child.to_string_lossy().to_string();
            let modified_at = metadata_modified_at(&md);

            if is_subtitle_file(&child) {
                subtitles = subtitles.saturating_add(1);
            } else {
                videos = videos.saturating_add(1);
            }
            seen_paths.insert(file_path.clone());
            files.push(ScannedMediaFile {
                file_name,
                file_path,
                file_size: i64::try_from(md.len()).context("文件大小超出 SQLite INTEGER 范围")?,
                modified_at,
                file_type,
                scanned_at: scanned_at.clone(),
            });
        }
    }

    let mut tx = pool.begin().await?;
    for file in &files {
        sqlx::query(
            r#"
            INSERT INTO media_files (
                root_id, file_name, file_path, file_size, modified_at, file_type, scanned_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(file_path) DO UPDATE SET
                root_id = excluded.root_id,
                file_name = excluded.file_name,
                file_size = excluded.file_size,
                modified_at = excluded.modified_at,
                file_type = excluded.file_type,
                scanned_at = excluded.scanned_at,
                updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            "#,
        )
        .bind(root_id)
        .bind(&file.file_name)
        .bind(&file.file_path)
        .bind(file.file_size)
        .bind(&file.modified_at)
        .bind(file.file_type.as_str())
        .bind(&file.scanned_at)
        .execute(&mut *tx)
        .await?;
    }

    let removed = match cleanup_scope {
        ScanCleanupScope::Root => {
            sqlx::query("DELETE FROM media_files WHERE root_id = ?1 AND scanned_at <> ?2")
                .bind(root_id)
                .bind(&scanned_at)
                .execute(&mut *tx)
                .await?
                .rows_affected()
        }
        ScanCleanupScope::Dir => {
            let pattern = format!("{}%", escape_sqlite_like(&scan_dir_prefix(&root)));
            sqlx::query(
                r#"
                DELETE FROM media_files
                WHERE root_id = ?1
                  AND scanned_at <> ?2
                  AND file_path LIKE ?3 ESCAPE '\'
                "#,
            )
            .bind(root_id)
            .bind(&scanned_at)
            .bind(pattern)
            .execute(&mut *tx)
            .await?
            .rows_affected()
        }
    };

    sqlx::query(
        r#"
        UPDATE media_resource_roots
        SET last_scanned_at = ?2,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ?1
        "#,
    )
    .bind(root_id)
    .bind(&scanned_at)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(MediaLibraryScanRes {
        scanned: u32::try_from(seen_paths.len()).unwrap_or(u32::MAX),
        videos,
        subtitles,
        removed: u32::try_from(removed).unwrap_or(u32::MAX),
    })
}

/// 单次扫描收集到的媒体文件。
struct ScannedMediaFile {
    file_name: String,
    file_path: String,
    file_size: i64,
    modified_at: String,
    file_type: MediaFileType,
    scanned_at: String,
}

async fn find_media_root(pool: &SqlitePool, id: i64) -> Result<MediaRootRecord> {
    sqlx::query_as::<_, MediaRootRecord>(
        r#"
        SELECT id, path, name, created_at, updated_at, last_scanned_at
        FROM media_resource_roots
        WHERE id = ?1
        "#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("媒体资源目录不存在"))
}

/// 用户输入路径和真实路径。前者用于展示/入库，后者仅用于比较映射盘、符号链接等真实位置。
struct NormalizedDir {
    display_path: PathBuf,
    real_path: PathBuf,
}

async fn normalize_existing_dir(raw: &str) -> Result<NormalizedDir> {
    let path_text = raw.trim();
    if path_text.is_empty() {
        bail!("path 不能为空");
    }
    let display_path = PathBuf::from(path_text);
    if !display_path.is_absolute() {
        bail!("path 必须为绝对路径");
    }
    if !tokio::fs::try_exists(&display_path).await? {
        bail!("path 不存在");
    }
    let meta = tokio::fs::metadata(&display_path).await?;
    if !meta.is_dir() {
        bail!("path 必须为目录");
    }
    let real_path = tokio::fs::canonicalize(&display_path)
        .await
        .with_context(|| format!("规范化路径失败: {}", display_path.display()))?;
    Ok(NormalizedDir {
        display_path,
        real_path,
    })
}

async fn ensure_not_overlapping(
    pool: &SqlitePool,
    new_path: &Path,
    exclude_id: Option<i64>,
) -> Result<()> {
    let roots = list_media_roots(pool).await?;
    for root in roots {
        if exclude_id == Some(i64::from(root.id)) {
            continue;
        }
        let existing = tokio::fs::canonicalize(&root.path)
            .await
            .unwrap_or_else(|_| PathBuf::from(&root.path));
        if paths_overlap(new_path, &existing) {
            bail!(
                "媒体资源路径不能互相包含：{} 与 {}",
                new_path.display(),
                root.path
            );
        }
    }
    Ok(())
}

fn paths_overlap(a: &Path, b: &Path) -> bool {
    a == b || a.starts_with(b) || b.starts_with(a)
}

fn default_root_name(path: &Path) -> String {
    path.file_name()
        .and_then(OsStr::to_str)
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn file_name_string(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(OsStr::to_str)
        .map(ToOwned::to_owned)
}

fn metadata_modified_at(md: &std::fs::Metadata) -> String {
    let modified = md.modified().unwrap_or(SystemTime::UNIX_EPOCH);
    DateTime::<Utc>::from(modified).to_rfc3339()
}

fn media_root_to_api(row: MediaRootRecord) -> Result<MediaRootRow> {
    Ok(MediaRootRow {
        id: i54(row.id, "媒体资源目录 id 超出 JS 安全整数范围")?,
        path: row.path,
        name: row.name,
        created_at: row.created_at,
        updated_at: row.updated_at,
        last_scanned_at: row.last_scanned_at,
    })
}

fn media_subtitle_to_api(row: &MediaFileRecord) -> Result<MediaSubtitleRow> {
    Ok(MediaSubtitleRow {
        id: i54(row.id, "媒体文件 id 超出 JS 安全整数范围")?,
        file_name: row.file_name.clone(),
        file_path: row.file_path.clone(),
        file_size: u53(
            u64::try_from(row.file_size).context("文件大小不能为负数")?,
            "文件大小超出 JS 安全整数范围",
        )?,
        modified_at: row.modified_at.clone(),
        scanned_at: row.scanned_at.clone(),
    })
}

fn media_video_to_api(
    row: MediaFileRecord,
    subtitle_rows: &[MediaFileRecord],
) -> Result<MediaVideoRow> {
    let subtitles = subtitle_rows
        .iter()
        .filter(|subtitle| subtitle_matches_video(&row.file_path, &subtitle.file_path))
        .map(media_subtitle_to_api)
        .collect::<Result<Vec<_>>>()?;

    Ok(MediaVideoRow {
        id: i54(row.id, "媒体文件 id 超出 JS 安全整数范围")?,
        root_id: i54(row.root_id, "媒体资源目录 id 超出 JS 安全整数范围")?,
        file_name: row.file_name,
        file_path: row.file_path,
        file_size: u53(
            u64::try_from(row.file_size).context("文件大小不能为负数")?,
            "文件大小超出 JS 安全整数范围",
        )?,
        modified_at: row.modified_at,
        scanned_at: row.scanned_at,
        subtitle_count: u32::try_from(subtitles.len()).unwrap_or(u32::MAX),
        subtitles,
    })
}

async fn subtitle_records_for_videos(
    pool: &SqlitePool,
    videos: &[MediaFileRecord],
) -> Result<Vec<MediaFileRecord>> {
    if videos.is_empty() {
        return Ok(Vec::new());
    }

    let mut root_ids = videos.iter().map(|row| row.root_id).collect::<Vec<_>>();
    root_ids.sort_unstable();
    root_ids.dedup();

    let mut builder = QueryBuilder::<Sqlite>::new(
        r#"
        SELECT id, root_id, file_name, file_path, file_size, modified_at, scanned_at
        FROM media_files
        WHERE file_type = 
        "#,
    );
    builder.push_bind(MediaFileType::Subtitle.as_str());
    builder.push(" AND root_id IN (");
    let mut separated = builder.separated(", ");
    for root_id in root_ids {
        separated.push_bind(root_id);
    }
    separated.push_unseparated(") ORDER BY file_path ASC");

    builder
        .build_query_as::<MediaFileRecord>()
        .fetch_all(pool)
        .await
        .map_err(Into::into)
}

async fn find_video_by_path(pool: &SqlitePool, video_path: &str) -> Result<MediaFileRecord> {
    sqlx::query_as::<_, MediaFileRecord>(
        r#"
        SELECT id, root_id, file_name, file_path, file_size, modified_at, scanned_at
        FROM media_files
        WHERE file_path = ?1 AND file_type = ?2
        "#,
    )
    .bind(video_path)
    .bind(MediaFileType::Video.as_str())
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| anyhow::anyhow!("视频不存在或未入库: {video_path}"))
}

async fn remove_file_if_exists(path: &str) -> Result<()> {
    let p = Path::new(path);
    if !tokio::fs::try_exists(p).await? {
        return Ok(());
    }
    let meta = tokio::fs::metadata(p).await?;
    if !meta.is_file() {
        bail!("path 不能为目录: {path}");
    }
    tokio::fs::remove_file(p)
        .await
        .with_context(|| format!("删除文件失败: {path}"))
}

fn subtitle_matches_video(video_path: &str, subtitle_path: &str) -> bool {
    let video = Path::new(video_path);
    let subtitle = Path::new(subtitle_path);
    if video.parent() != subtitle.parent() {
        return false;
    }

    let Some(video_stem) = video.file_stem().and_then(OsStr::to_str) else {
        return false;
    };
    let Some(subtitle_stem) = subtitle.file_stem().and_then(OsStr::to_str) else {
        return false;
    };

    subtitle_stem == video_stem
        || subtitle_stem
            .strip_prefix(video_stem)
            .is_some_and(|rest| rest.starts_with('.'))
}

fn scan_dir_prefix(dir: &Path) -> String {
    let mut prefix = dir.to_string_lossy().to_string();
    if !prefix.ends_with(std::path::MAIN_SEPARATOR) {
        prefix.push(std::path::MAIN_SEPARATOR);
    }
    prefix
}

fn escape_sqlite_like(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(ch);
    }
    escaped
}

fn push_media_file_filters<'a>(
    builder: &mut QueryBuilder<'a, Sqlite>,
    root_id: Option<i64>,
    file_type: Option<&'a str>,
    keyword: Option<&'a str>,
) {
    if root_id.is_none() && file_type.is_none() && keyword.is_none() {
        return;
    }

    let mut has_filter = false;
    if let Some(root_id) = root_id {
        push_where_or_and(builder, &mut has_filter);
        builder.push("root_id = ");
        builder.push_bind(root_id);
    }
    if let Some(file_type) = file_type {
        push_where_or_and(builder, &mut has_filter);
        builder.push("file_type = ");
        builder.push_bind(file_type);
    }
    if let Some(keyword) = keyword {
        push_where_or_and(builder, &mut has_filter);
        builder.push("(file_name LIKE ");
        builder.push_bind(keyword);
        builder.push(" OR file_path LIKE ");
        builder.push_bind(keyword);
        builder.push(")");
    }
}

fn push_where_or_and(builder: &mut QueryBuilder<'_, Sqlite>, has_filter: &mut bool) {
    if *has_filter {
        builder.push(" AND ");
    } else {
        builder.push(" WHERE ");
        *has_filter = true;
    }
}

fn i54(value: i64, msg: &'static str) -> Result<I54> {
    I54::try_from(value).map_err(|_| anyhow::anyhow!(msg))
}

fn u53(value: u64, msg: &'static str) -> Result<U53> {
    U53::try_from(value).map_err(|_| anyhow::anyhow!(msg))
}
