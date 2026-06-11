use serde::{Deserialize, Deserializer, Serialize};
use utoipa::{IntoParams, ToSchema};

use super::filter::StashSceneFilterType;
use super::path::StashPathMapping;

fn null_as_empty_vec<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}

/// Stash 连接配置（持久化于应用 `AppConfig`）。
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashConnectConfig {
    /// 实例根地址，如 `http://127.0.0.1:9999`
    pub base_url: String,
    /// GraphQL / 媒体请求使用的 ApiKey；无鉴权时可留空
    pub api_key: String,
    /// Stash 视角文件路径到本服务本地文件路径的前缀映射。
    #[serde(default)]
    pub path_mappings: Vec<StashPathMapping>,
}

impl Default for StashConnectConfig {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            api_key: String::new(),
            path_mappings: Vec::new(),
        }
    }
}

fn default_list_page() -> i32 {
    1
}

fn default_list_page_size() -> i32 {
    20
}

#[typeshare::typeshare]
#[derive(Debug, Deserialize, ToSchema)]
pub struct StashSceneListReq {
    pub filter: StashFilter,
    /// 对应 GraphQL `SceneFilterType`
    #[serde(default)]
    pub scene_filter: Option<StashSceneFilterType>,
    /// 对应 GraphQL `scene_ids`
    #[serde(default)]
    pub scene_ids: Option<Vec<i32>>,
}

/// Stash 场景列表查询（分页字段与 ProTable 对齐，服务端映射为 Stash `FindFilterType`）
#[typeshare::typeshare]
#[derive(Debug, Deserialize, ToSchema)]
pub struct StashFilter {
    #[serde(default = "default_list_page")]
    pub page: i32,
    #[serde(default = "default_list_page_size")]
    pub page_size: i32,
    pub q: Option<String>,
    pub sort: Option<String>,
    /// `ASC` 或 `DESC`
    pub direction: Option<String>,
}

#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashSceneFile {
    pub path: String,
    pub basename: String,
    /// 影片时长，单位为秒。
    #[serde(default)]
    pub duration: Option<f64>,
    /// 根据 `stash_config.path_mappings` 映射出的本服务本地路径。
    #[serde(default)]
    pub local_path: Option<String>,
}

#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashScenePaths {
    pub screenshot: String,
    pub preview: String,
    // pub stream: String,
    // pub webp: String,
    // pub vtt: String,
    // pub sprite: String,
    // pub funscript: String,
    // pub interactive_heatmap: String,
}

#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashSceneCaption {
    #[serde(default)]
    pub language_code: Option<String>,
    #[serde(default)]
    pub caption_type: Option<String>,
    /// Stash 视角推导出的字幕文件路径。
    #[serde(default)]
    pub path: Option<String>,
    /// 根据 `stash_config.path_mappings` 映射出的本服务本地字幕路径。
    #[serde(default)]
    pub local_path: Option<String>,
}

#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashSceneRow {
    pub id: String,
    pub title: String,
    pub date: Option<String>,
    pub files: Vec<StashSceneFile>,
    pub paths: StashScenePaths,
    #[serde(default, deserialize_with = "null_as_empty_vec")]
    pub captions: Vec<StashSceneCaption>,
    /// 最后播放时间
    pub last_played_at: Option<String>,
}

/// Stash 可搜索实体类型。
#[typeshare::typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum StashEntityKind {
    /// 工作室
    Studio,
    /// 演员
    Performer,
    /// 标签
    Tag,
}

fn default_entity_search_page_size() -> i32 {
    20
}

/// Stash 实体搜索查询参数。
#[typeshare::typeshare]
#[derive(Debug, Clone, Deserialize, IntoParams, ToSchema)]
pub struct StashEntitySearchReq {
    /// 实体类型。
    pub kind: StashEntityKind,
    /// 搜索关键词。
    pub q: Option<String>,
    /// 返回数量。
    #[serde(default = "default_entity_search_page_size")]
    pub page_size: i32,
}

/// Stash 实体搜索项。
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashEntitySearchItem {
    /// Stash 实体 ID。
    pub id: String,
    /// 显示名称。
    pub name: String,
    /// 演员重名区分信息，其他实体为空。
    #[serde(default)]
    pub disambiguation: Option<String>,
}

/// Stash 实体搜索结果。
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashEntitySearchRes {
    /// 命中的实体列表。
    pub items: Vec<StashEntitySearchItem>,
}
