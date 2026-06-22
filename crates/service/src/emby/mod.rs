use anyhow::{Context, Result, anyhow};
use bytes::Bytes;
use futures::Stream;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE, HeaderMap, HeaderName, RANGE};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::pin::Pin;
use typeshare::typeshare;
use utoipa::{IntoParams, ToSchema};

pub type EmbyBodyStream = Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>;

/// Emby 服务器连接配置（持久化于应用 `AppConfig`）。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EmbyConnectConfig {
    /// Emby 实例根地址，如 `http://127.0.0.1:8096`
    pub base_url: String,
    /// Emby 用户名。未配置 API Key 时用于用户名密码登录。
    pub username: String,
    /// Emby 用户密码。设置页保存时留空不覆盖旧值。
    pub password: String,
    /// Emby API Key。填写后优先使用 API Key 访问。
    pub api_key: String,
    /// 已缓存的用户 ID。用户名密码登录成功后自动写入配置。
    #[serde(default)]
    pub user_id: String,
}

impl Default for EmbyConnectConfig {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            username: String::new(),
            password: String::new(),
            api_key: String::new(),
            user_id: String::new(),
        }
    }
}

/// Emby 连接测试结果。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EmbyConnectionStatus {
    pub ok: bool,
    pub server_name: Option<String>,
    pub user_name: Option<String>,
    pub user_id: Option<String>,
}

/// Emby 资源类型。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EmbyLibraryItem {
    pub id: String,
    pub name: String,
    pub item_type: String,
    #[serde(default)]
    pub collection_type: Option<String>,
    #[serde(default)]
    pub overview: Option<String>,
    #[serde(default)]
    pub production_year: Option<i32>,
    #[serde(default)]
    pub run_time_ticks: Option<i64>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub image_tag: Option<String>,
    #[serde(default)]
    pub backdrop_image_tag: Option<String>,
    #[serde(default)]
    pub child_count: Option<i32>,
    #[serde(default)]
    pub index_number: Option<i32>,
    #[serde(default)]
    pub parent_index_number: Option<i32>,
    #[serde(default)]
    pub premiere_date: Option<String>,
    #[serde(default)]
    pub community_rating: Option<f64>,
    #[serde(default)]
    pub official_rating: Option<String>,
    pub can_play: bool,
    pub can_browse: bool,
}

/// Emby 资源列表响应。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EmbyItemsRes {
    pub items: Vec<EmbyLibraryItem>,
    pub total: i32,
}

/// Emby 单个媒体库分组及其资源。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EmbyLibrarySection {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub collection_type: Option<String>,
    pub items: Vec<EmbyLibraryItem>,
    pub total: i32,
}

/// Emby 媒体库分组响应。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EmbySectionsRes {
    pub sections: Vec<EmbyLibrarySection>,
}

/// Emby 资源列表查询参数（递归返回可播放资源，不按文件夹层级展示）。
#[typeshare]
#[derive(Debug, Clone, Deserialize, IntoParams, ToSchema)]
pub struct EmbyItemsQuery {
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub include_item_types: Option<String>,
    #[serde(default)]
    pub recursive: Option<bool>,
    #[serde(default = "default_start_index")]
    pub start_index: i32,
    #[serde(default = "default_limit")]
    pub limit: i32,
}

/// Emby 媒体库分组查询参数。
#[typeshare]
#[derive(Debug, Clone, Deserialize, IntoParams, ToSchema)]
pub struct EmbySectionsQuery {
    #[serde(default)]
    pub q: Option<String>,
    #[serde(default = "default_section_limit")]
    pub limit: i32,
}

/// Emby 视频流查询参数。
#[typeshare]
#[derive(Debug, Clone, Deserialize, IntoParams, ToSchema)]
pub struct EmbyStreamQuery {
    pub item_id: String,
}

/// Emby 播放方式。
#[typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum EmbyPlaybackMethod {
    DirectPlay,
    DirectStream,
    Transcode,
}

/// Emby 播放信息，供前端决定直链、原始流或转码流。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EmbyPlaybackInfo {
    pub item_id: String,
    pub is_strm: bool,
    #[serde(default)]
    pub direct_url: Option<String>,
    #[serde(default)]
    pub media_source_id: Option<String>,
    #[serde(default)]
    pub run_time_ticks: Option<i64>,
    #[serde(default)]
    pub playback_position_ticks: Option<i64>,
    #[serde(default)]
    pub played_percentage: Option<f64>,
}

/// Emby 播放进度上报请求。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EmbyPlaybackProgressReq {
    pub item_id: String,
    pub position_ticks: i64,
    #[serde(default)]
    pub is_paused: bool,
    #[serde(default)]
    pub is_muted: bool,
    #[serde(default)]
    pub volume_level: Option<i32>,
    #[serde(default)]
    pub media_source_id: Option<String>,
    #[serde(default)]
    pub play_method: Option<EmbyPlaybackMethod>,
}

/// Emby 播放进度上报结果。
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct EmbyPlaybackSyncRes {
    pub ok: bool,
}

/// 被代理的 Emby 媒体流。
pub struct ProxiedEmbyMedia {
    pub status: reqwest::StatusCode,
    pub headers: HeaderMap,
    pub body: EmbyBodyStream,
}

#[derive(Debug, Deserialize)]
struct PublicSystemInfo {
    #[serde(rename = "ServerName")]
    server_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct AuthenticateResponse {
    #[serde(rename = "AccessToken")]
    access_token: String,
    #[serde(rename = "User")]
    user: EmbyUser,
}

#[derive(Debug, Deserialize)]
struct EmbyUser {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "Name")]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct UserListItem {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "Name")]
    name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ItemsEnvelope {
    #[serde(rename = "Items", default)]
    items: Vec<RawEmbyItem>,
    #[serde(rename = "TotalRecordCount", default)]
    total_record_count: i32,
}

#[derive(Debug, Deserialize)]
struct RawEmbyItem {
    #[serde(rename = "Id")]
    id: String,
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "Type")]
    item_type: String,
    #[serde(rename = "CollectionType")]
    collection_type: Option<String>,
    #[serde(rename = "Overview")]
    overview: Option<String>,
    #[serde(rename = "ProductionYear")]
    production_year: Option<i32>,
    #[serde(rename = "RunTimeTicks")]
    run_time_ticks: Option<i64>,
    #[serde(rename = "ParentId")]
    parent_id: Option<String>,
    #[serde(rename = "ImageTags")]
    image_tags: Option<std::collections::HashMap<String, String>>,
    #[serde(rename = "BackdropImageTags")]
    backdrop_image_tags: Option<Vec<String>>,
    #[serde(rename = "ChildCount")]
    child_count: Option<i32>,
    #[serde(rename = "IsFolder")]
    is_folder: Option<bool>,
    #[serde(rename = "IndexNumber")]
    index_number: Option<i32>,
    #[serde(rename = "ParentIndexNumber")]
    parent_index_number: Option<i32>,
    #[serde(rename = "PremiereDate")]
    premiere_date: Option<String>,
    #[serde(rename = "CommunityRating")]
    community_rating: Option<f64>,
    #[serde(rename = "OfficialRating")]
    official_rating: Option<String>,
    #[serde(rename = "Path")]
    path: Option<String>,
    #[serde(rename = "MediaSources", default)]
    media_sources: Vec<RawMediaSource>,
    #[serde(rename = "UserData")]
    user_data: Option<RawUserData>,
}

#[derive(Debug, Deserialize)]
struct RawMediaSource {
    #[serde(rename = "Id")]
    id: Option<String>,
    #[serde(rename = "Path")]
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawUserData {
    #[serde(rename = "PlaybackPositionTicks")]
    playback_position_ticks: Option<i64>,
    #[serde(rename = "PlayedPercentage")]
    played_percentage: Option<f64>,
}

fn default_start_index() -> i32 {
    0
}

fn default_limit() -> i32 {
    50
}

fn default_section_limit() -> i32 {
    18
}

/// 校验 Emby 连接配置是否可用于请求。
pub fn ensure_emby_config(cfg: &EmbyConnectConfig) -> Result<()> {
    if cfg.base_url.trim().is_empty() {
        return Err(anyhow!(
            "未配置 Emby 服务地址，请在设置页填写 Emby Base URL"
        ));
    }
    if cfg.api_key.trim().is_empty()
        && (cfg.username.trim().is_empty() || cfg.password.trim().is_empty())
    {
        return Err(anyhow!("请填写 Emby API Key，或填写用户名和密码"));
    }
    Ok(())
}

fn normalized_base_url(cfg: &EmbyConnectConfig) -> Result<String> {
    ensure_emby_config(cfg)?;
    Ok(cfg.base_url.trim().trim_end_matches('/').to_string())
}

fn client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?)
}

fn media_client() -> Result<reqwest::Client> {
    Ok(reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .build()?)
}

fn auth_header(value: &str) -> String {
    format!(
        r#"MediaBrowser Client="Media Admin", Device="Media Admin", DeviceId="media-admin", Version="0.1.0", Token="{value}""#
    )
}

async fn authenticate(cfg: &EmbyConnectConfig) -> Result<(String, String, Option<String>)> {
    let base_url = normalized_base_url(cfg)?;
    if !cfg.api_key.trim().is_empty() {
        let token = cfg.api_key.trim().to_string();
        if let Some(user_id) = trim_non_empty(&cfg.user_id) {
            if looks_like_emby_user_id(user_id) {
                return Ok((token, user_id.to_string(), None));
            }
        }

        let username = trim_non_empty(&cfg.username)
            .or_else(|| trim_non_empty(&cfg.user_id))
            .ok_or_else(|| anyhow!("使用 Emby API Key 时需要配置用户名或用户 ID"))?;
        let user = find_user_by_name(&base_url, &token, username).await?;
        return Ok((token, user.id, user.name));
    }

    let resp = client()?
        .post(format!("{base_url}/Users/AuthenticateByName"))
        .header(AUTHORIZATION, auth_header(""))
        .json(&serde_json::json!({
            "Username": cfg.username.trim(),
            "Pw": cfg.password,
        }))
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(anyhow!("emby auth http {}: {}", status.as_u16(), text));
    }
    let auth: AuthenticateResponse =
        serde_json::from_str(&text).context("解析 Emby 登录响应失败")?;
    Ok((auth.access_token, auth.user.id, auth.user.name))
}

fn trim_non_empty(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

fn looks_like_emby_user_id(value: &str) -> bool {
    let value = value.trim();
    if value.len() == 32 {
        return value.chars().all(|c| c.is_ascii_hexdigit());
    }
    if value.len() == 36 {
        return value.chars().enumerate().all(|(index, c)| {
            matches!(index, 8 | 13 | 18 | 23) && c == '-' || c.is_ascii_hexdigit()
        });
    }
    false
}

async fn find_user_by_name(base_url: &str, token: &str, username: &str) -> Result<UserListItem> {
    let resp = client()?
        .get(format!("{base_url}/Users"))
        .header(AUTHORIZATION, auth_header(token))
        .header(ACCEPT, "application/json")
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(anyhow!("emby users http {}: {}", status.as_u16(), text));
    }

    let users: Vec<UserListItem> = serde_json::from_str(&text).context("解析 Emby 用户列表失败")?;
    users
        .into_iter()
        .find(|user| {
            user.name
                .as_deref()
                .is_some_and(|name| name.eq_ignore_ascii_case(username))
        })
        .ok_or_else(|| anyhow!("未在 Emby 中找到用户：{username}"))
}

/// 测试 Emby 连接并返回服务器和用户信息。
pub async fn test_connection(cfg: &EmbyConnectConfig) -> Result<EmbyConnectionStatus> {
    let base_url = normalized_base_url(cfg)?;
    let public_info = client()?
        .get(format!("{base_url}/System/Info/Public"))
        .send()
        .await?
        .json::<PublicSystemInfo>()
        .await
        .ok();
    let (_, user_id, user_name) = authenticate(cfg).await?;

    Ok(EmbyConnectionStatus {
        ok: true,
        server_name: public_info.and_then(|info| info.server_name),
        user_name,
        user_id: Some(user_id),
    })
}

/// 调用 Emby 资源列表接口。
pub async fn list_items(cfg: &EmbyConnectConfig, q: EmbyItemsQuery) -> Result<EmbyItemsRes> {
    let base_url = normalized_base_url(cfg)?;
    let (token, user_id, _) = authenticate(cfg).await?;
    let include_item_types = q
        .include_item_types
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Movie,Episode,Video");
    let mut req = client()?
        .get(format!("{base_url}/Users/{user_id}/Items"))
        .header(AUTHORIZATION, auth_header(&token))
        .header(ACCEPT, "application/json")
        .query(&[
            ("Recursive", q.recursive.unwrap_or(true).to_string()),
            ("IncludeItemTypes", include_item_types.to_string()),
            (
                "Fields",
                "Overview,PrimaryImageAspectRatio,RunTimeTicks,ChildCount,PremiereDate,CommunityRating,OfficialRating,IndexNumber,ParentIndexNumber,BackdropImageTags".to_string(),
            ),
            ("SortBy", "SortName".to_string()),
            ("SortOrder", "Ascending".to_string()),
            ("StartIndex", q.start_index.max(0).to_string()),
            ("Limit", q.limit.clamp(1, 200).to_string()),
        ]);

    if let Some(search) = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        req = req.query(&[("SearchTerm", search)]);
    }
    if let Some(parent_id) = q
        .parent_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        req = req.query(&[("ParentId", parent_id)]);
    }

    let resp = req.send().await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(anyhow!("emby items http {}: {}", status.as_u16(), text));
    }

    let envelope: ItemsEnvelope = serde_json::from_str(&text).context("解析 Emby 资源列表失败")?;
    Ok(EmbyItemsRes {
        items: envelope.items.into_iter().map(map_item).collect(),
        total: envelope.total_record_count,
    })
}

/// 按 Emby 媒体库分组查询可播放资源。
pub async fn list_sections(
    cfg: &EmbyConnectConfig,
    q: EmbySectionsQuery,
) -> Result<EmbySectionsRes> {
    let base_url = normalized_base_url(cfg)?;
    let (token, user_id, _) = authenticate(cfg).await?;
    let views = fetch_child_items(
        &base_url,
        &token,
        &user_id,
        EmbyItemsQuery {
            q: None,
            parent_id: None,
            include_item_types: None,
            recursive: None,
            start_index: 0,
            limit: 100,
        },
        false,
        None,
    )
    .await?;

    let mut sections = Vec::new();
    for view in views.items {
        let section_items = fetch_child_items(
            &base_url,
            &token,
            &user_id,
            EmbyItemsQuery {
                q: q.q.clone(),
                parent_id: None,
                include_item_types: None,
                recursive: None,
                start_index: 0,
                limit: q.limit,
            },
            true,
            Some(&view.id),
        )
        .await?;
        if section_items.items.is_empty()
            && q.q.as_deref().is_some_and(|value| !value.trim().is_empty())
        {
            continue;
        }
        sections.push(EmbyLibrarySection {
            id: view.id,
            name: view.name,
            collection_type: view.collection_type,
            items: section_items.items,
            total: section_items.total,
        });
    }

    Ok(EmbySectionsRes { sections })
}

async fn fetch_child_items(
    base_url: &str,
    token: &str,
    user_id: &str,
    q: EmbyItemsQuery,
    recursive: bool,
    parent_id: Option<&str>,
) -> Result<EmbyItemsRes> {
    let mut req = client()?
        .get(format!("{base_url}/Users/{user_id}/Items"))
        .header(AUTHORIZATION, auth_header(token))
        .header(ACCEPT, "application/json")
        .query(&[
            ("Recursive", recursive.to_string()),
            (
                "Fields",
                "Overview,PrimaryImageAspectRatio,RunTimeTicks,ChildCount".to_string(),
            ),
            ("SortBy", "SortName".to_string()),
            ("SortOrder", "Ascending".to_string()),
            ("StartIndex", q.start_index.max(0).to_string()),
            ("Limit", q.limit.clamp(1, 200).to_string()),
        ]);

    if recursive {
        req = req.query(&[("IncludeItemTypes", "Movie,Episode,Video")]);
    }
    if let Some(parent_id) = parent_id.map(str::trim).filter(|s| !s.is_empty()) {
        req = req.query(&[("ParentId", parent_id)]);
    }
    if let Some(search) = q.q.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        req = req.query(&[("SearchTerm", search)]);
    }

    let resp = req.send().await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(anyhow!("emby items http {}: {}", status.as_u16(), text));
    }

    let envelope: ItemsEnvelope = serde_json::from_str(&text).context("解析 Emby 资源列表失败")?;
    Ok(EmbyItemsRes {
        items: envelope.items.into_iter().map(map_item).collect(),
        total: envelope.total_record_count,
    })
}

/// 查询单个 Emby 资源详情。
pub async fn get_item(cfg: &EmbyConnectConfig, item_id: &str) -> Result<EmbyLibraryItem> {
    let base_url = normalized_base_url(cfg)?;
    let (token, user_id, _) = authenticate(cfg).await?;
    let resp = client()?
        .get(format!("{base_url}/Users/{user_id}/Items/{item_id}"))
        .header(AUTHORIZATION, auth_header(&token))
        .header(ACCEPT, "application/json")
        .query(&[("Fields", emby_item_detail_fields())])
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(anyhow!("emby item http {}: {}", status.as_u16(), text));
    }
    let item: RawEmbyItem = serde_json::from_str(&text).context("解析 Emby 资源详情失败")?;
    Ok(map_item(item))
}

/// 查询 Emby 播放信息，识别 `.strm` 并解析其真实 URL。
pub async fn get_playback_info(cfg: &EmbyConnectConfig, item_id: &str) -> Result<EmbyPlaybackInfo> {
    let base_url = normalized_base_url(cfg)?;
    let (token, user_id, _) = authenticate(cfg).await?;
    let item = fetch_raw_item(&base_url, &token, &user_id, item_id).await?;
    let media_source_id = item
        .media_sources
        .iter()
        .find_map(|source| source.id.as_deref().map(str::to_string));
    let candidate_paths = item
        .media_sources
        .iter()
        .filter_map(|source| source.path.as_deref())
        .chain(item.path.as_deref())
        .collect::<Vec<_>>();
    let is_strm = candidate_paths.iter().any(|path| is_strm_path(path));
    let direct_url = resolve_direct_strm_url(&base_url, &token, item_id, &candidate_paths).await?;
    let user_data = item.user_data;

    Ok(EmbyPlaybackInfo {
        item_id: item.id,
        is_strm,
        direct_url,
        media_source_id,
        run_time_ticks: item.run_time_ticks,
        playback_position_ticks: user_data
            .as_ref()
            .and_then(|data| data.playback_position_ticks),
        played_percentage: user_data.and_then(|data| data.played_percentage),
    })
}

async fn fetch_raw_item(
    base_url: &str,
    token: &str,
    user_id: &str,
    item_id: &str,
) -> Result<RawEmbyItem> {
    let resp = client()?
        .get(format!("{base_url}/Users/{user_id}/Items/{item_id}"))
        .header(AUTHORIZATION, auth_header(token))
        .header(ACCEPT, "application/json")
        .query(&[("Fields", emby_item_detail_fields())])
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(anyhow!("emby item http {}: {}", status.as_u16(), text));
    }
    serde_json::from_str(&text).context("解析 Emby 资源详情失败")
}

fn emby_item_detail_fields() -> &'static str {
    "Overview,RunTimeTicks,ChildCount,PremiereDate,CommunityRating,OfficialRating,IndexNumber,ParentIndexNumber,BackdropImageTags,Path,MediaSources,UserData"
}

fn is_http_url(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn is_strm_path(value: &str) -> bool {
    Path::new(value)
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("strm"))
}

async fn resolve_direct_strm_url(
    base_url: &str,
    token: &str,
    item_id: &str,
    candidate_paths: &[&str],
) -> Result<Option<String>> {
    for path in candidate_paths {
        let trimmed = path.trim();
        if is_http_url(trimmed) {
            return Ok(Some(trimmed.to_string()));
        }
    }

    if !candidate_paths.iter().any(|path| is_strm_path(path)) {
        return Ok(None);
    }

    for path in candidate_paths {
        let trimmed = path.trim();
        if !is_strm_path(trimmed) {
            continue;
        }
        if let Ok(content) = tokio::fs::read_to_string(trimmed).await {
            if let Some(url) = first_url_from_strm_content(&content) {
                return Ok(Some(url));
            }
        }
    }

    fetch_strm_file_url_from_emby(base_url, token, item_id).await
}

fn first_url_from_strm_content(content: &str) -> Option<String> {
    content
        .lines()
        .map(str::trim)
        .find(|line| is_http_url(line))
        .map(str::to_string)
}

async fn fetch_strm_file_url_from_emby(
    base_url: &str,
    token: &str,
    item_id: &str,
) -> Result<Option<String>> {
    let mut url = reqwest::Url::parse(&format!("{base_url}/Items/{item_id}/File"))
        .context("构建 Emby strm 文件地址失败")?;
    url.query_pairs_mut().append_pair("api_key", token);

    let resp = client()?
        .get(url)
        .header(AUTHORIZATION, auth_header(token))
        .header(ACCEPT, "text/plain")
        .send()
        .await?;
    if !resp.status().is_success() {
        return Ok(None);
    }
    let text = resp.text().await.unwrap_or_default();
    Ok(first_url_from_strm_content(&text))
}

/// 向 Emby 上报播放开始。
pub async fn report_playback_start(
    cfg: &EmbyConnectConfig,
    req: EmbyPlaybackProgressReq,
) -> Result<EmbyPlaybackSyncRes> {
    report_playback_event(cfg, "Playing", req).await
}

/// 向 Emby 上报播放进度。
pub async fn report_playback_progress(
    cfg: &EmbyConnectConfig,
    req: EmbyPlaybackProgressReq,
) -> Result<EmbyPlaybackSyncRes> {
    report_playback_event(cfg, "Playing/Progress", req).await
}

/// 向 Emby 上报播放停止。
pub async fn report_playback_stopped(
    cfg: &EmbyConnectConfig,
    req: EmbyPlaybackProgressReq,
) -> Result<EmbyPlaybackSyncRes> {
    report_playback_event(cfg, "Playing/Stopped", req).await
}

async fn report_playback_event(
    cfg: &EmbyConnectConfig,
    endpoint: &str,
    req: EmbyPlaybackProgressReq,
) -> Result<EmbyPlaybackSyncRes> {
    let base_url = normalized_base_url(cfg)?;
    let (token, _, _) = authenticate(cfg).await?;
    let body = serde_json::json!({
        "ItemId": req.item_id,
        "MediaSourceId": req.media_source_id.unwrap_or_else(|| req.item_id.clone()),
        "PositionTicks": req.position_ticks.max(0),
        "IsPaused": req.is_paused,
        "IsMuted": req.is_muted,
        "VolumeLevel": req.volume_level.unwrap_or(100).clamp(0, 100),
        "CanSeek": true,
        "PlayMethod": emby_play_method_name(req.play_method.unwrap_or(EmbyPlaybackMethod::DirectStream)),
    });
    let resp = client()?
        .post(format!("{base_url}/Sessions/{endpoint}"))
        .header(AUTHORIZATION, auth_header(&token))
        .header(ACCEPT, "application/json")
        .json(&body)
        .send()
        .await?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(anyhow!(
            "emby playback {} http {}: {}",
            endpoint,
            status.as_u16(),
            text
        ));
    }
    Ok(EmbyPlaybackSyncRes { ok: true })
}

fn emby_play_method_name(method: EmbyPlaybackMethod) -> &'static str {
    match method {
        EmbyPlaybackMethod::DirectPlay => "DirectPlay",
        EmbyPlaybackMethod::DirectStream => "DirectStream",
        EmbyPlaybackMethod::Transcode => "Transcode",
    }
}

fn map_item(item: RawEmbyItem) -> EmbyLibraryItem {
    let image_tag = item.image_tags.and_then(|mut tags| tags.remove("Primary"));
    let backdrop_image_tag = item
        .backdrop_image_tags
        .and_then(|tags| tags.into_iter().next());
    let can_browse = item.is_folder.unwrap_or(false)
        || matches!(
            item.item_type.as_str(),
            "CollectionFolder" | "Folder" | "Series" | "Season" | "BoxSet"
        );
    let can_play = matches!(item.item_type.as_str(), "Movie" | "Episode" | "Video");

    EmbyLibraryItem {
        id: item.id,
        name: item.name,
        item_type: item.item_type,
        collection_type: item.collection_type,
        overview: item.overview,
        production_year: item.production_year,
        run_time_ticks: item.run_time_ticks,
        parent_id: item.parent_id,
        image_tag,
        backdrop_image_tag,
        child_count: item.child_count,
        index_number: item.index_number,
        parent_index_number: item.parent_index_number,
        premiere_date: item.premiere_date,
        community_rating: item.community_rating,
        official_rating: item.official_rating,
        can_play,
        can_browse,
    }
}

fn forward_response_header(name: &HeaderName) -> bool {
    matches!(
        name.as_str(),
        "content-type"
            | "content-length"
            | "content-range"
            | "accept-ranges"
            | "cache-control"
            | "etag"
            | "last-modified"
    )
}

/// 代理 Emby 图片。
pub fn image_url(item_id: &str, tag: Option<&str>, image_type: Option<&str>) -> String {
    let mut url = format!("/api/emby/items/{item_id}/image");
    let mut params = Vec::new();
    if let Some(tag) = tag.map(str::trim).filter(|s| !s.is_empty()) {
        params.push(format!("tag={}", urlencoding::encode(tag)));
    }
    if let Some(image_type) = image_type.map(str::trim).filter(|s| !s.is_empty()) {
        params.push(format!("image_type={}", urlencoding::encode(image_type)));
    }
    if !params.is_empty() {
        url.push('?');
        url.push_str(&params.join("&"));
    }
    url
}

/// 流式代理 Emby 图片。
pub async fn proxy_image(
    cfg: &EmbyConnectConfig,
    item_id: &str,
    tag: Option<&str>,
    image_type: Option<&str>,
) -> Result<ProxiedEmbyMedia> {
    let base_url = normalized_base_url(cfg)?;
    let (token, _, _) = authenticate(cfg).await?;
    let image_type = image_type
        .map(str::trim)
        .filter(|value| matches!(*value, "Primary" | "Thumb" | "Backdrop" | "Logo"))
        .unwrap_or("Primary");
    let mut url = format!("{base_url}/Items/{item_id}/Images/{image_type}");
    if let Some(tag) = tag.map(str::trim).filter(|s| !s.is_empty()) {
        url.push_str(&format!("?tag={}", urlencoding::encode(tag)));
    }
    proxy_url(&token, url, None).await
}

/// 流式代理 Emby 视频，转发客户端 `Range` 以支持 seek。
pub async fn proxy_stream(
    cfg: &EmbyConnectConfig,
    item_id: &str,
    request_range: Option<&str>,
) -> Result<ProxiedEmbyMedia> {
    let base_url = normalized_base_url(cfg)?;
    let (token, _, _) = authenticate(cfg).await?;
    let url = format!(
        "{base_url}/Videos/{item_id}/stream?static=true&api_key={}",
        urlencoding::encode(&token)
    );
    proxy_url(&token, url, request_range).await
}

/// 代理 Emby 转码后的 MP4 视频流，用于浏览器无法直接播放原始流时回退。
pub async fn proxy_transcoded_stream(
    cfg: &EmbyConnectConfig,
    item_id: &str,
) -> Result<ProxiedEmbyMedia> {
    let base_url = normalized_base_url(cfg)?;
    let (token, user_id, _) = authenticate(cfg).await?;
    let mut url = reqwest::Url::parse(&format!("{base_url}/Videos/{item_id}/stream.mp4"))
        .context("构建 Emby 转码地址失败")?;
    url.query_pairs_mut()
        .append_pair("api_key", &token)
        .append_pair("UserId", &user_id)
        .append_pair("MediaSourceId", item_id)
        .append_pair("DeviceId", "media-admin")
        .append_pair("Static", "false")
        .append_pair("Container", "mp4")
        .append_pair("TranscodingContainer", "mp4")
        .append_pair("TranscodingProtocol", "http")
        .append_pair("VideoCodec", "h264")
        .append_pair("AudioCodec", "aac")
        .append_pair("VideoBitrate", "8000000")
        .append_pair("AudioBitrate", "192000")
        .append_pair("MaxAudioChannels", "2")
        .append_pair("EnableSubtitlesInManifest", "false")
        .append_pair("EnableAudioVbrEncoding", "false");
    proxy_url(&token, url.to_string(), None).await
}

async fn proxy_url(
    token: &str,
    url: String,
    request_range: Option<&str>,
) -> Result<ProxiedEmbyMedia> {
    let mut req = media_client()?
        .get(&url)
        .header(AUTHORIZATION, auth_header(token));
    if let Some(range) = request_range {
        req = req.header(RANGE, range);
    }

    let resp = req.send().await?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("emby media http {}: {}", status.as_u16(), text));
    }

    if let Some(ct) = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
    {
        if ct.starts_with("text/html") {
            return Err(anyhow!("emby 返回了 HTML 而非媒体文件: {url}"));
        }
    }

    let mut headers = HeaderMap::new();
    for (name, value) in resp.headers().iter() {
        if forward_response_header(name) {
            headers.insert(name.clone(), value.clone());
        }
    }

    let body: EmbyBodyStream = Box::pin(resp.bytes_stream());
    Ok(ProxiedEmbyMedia {
        status,
        headers,
        body,
    })
}
