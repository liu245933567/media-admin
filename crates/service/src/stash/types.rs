use serde::{Deserialize, Serialize};

use super::filter::StashSceneFilterType;

fn default_list_page() -> i32 {
    1
}

fn default_list_page_size() -> i32 {
    20
}

#[typeshare::typeshare]
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Deserialize)]
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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashSceneFile {
    pub path: String,
    pub basename: String,
}

#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashScenePaths {
    pub screenshot: String,
    pub preview: String,
    // pub stream: String,
    // pub webp: String,
    // pub vtt: String,
    // pub sprite: String,
    // pub funscript: String,
    // pub interactive_heatmap: String,
    // pub caption: String,
}

#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashSceneRow {
    pub id: String,
    pub title: String,
    pub date: Option<String>,
    pub files: Vec<StashSceneFile>,
    pub paths: StashScenePaths,
}
