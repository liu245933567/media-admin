use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use utoipa::ToSchema;

/// GraphQL `Any` / 任意 JSON（透传 Stash 原生结构）
#[typeshare::typeshare(serialized_as = "unknown")]
pub type StashJsonValue = JsonValue;

/// Stash `CriterionModifier`（与 GraphQL 枚举值一致）
#[typeshare::typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
pub enum StashCriterionModifier {
    #[serde(rename = "=")]
    Eq,
    Equals,
    #[serde(rename = "!=")]
    NotEq,
    NotEquals,
    #[serde(rename = ">")]
    GreaterThanSymbol,
    GreaterThan,
    #[serde(rename = "<")]
    LessThanSymbol,
    LessThan,
    #[serde(rename = "IS NULL")]
    IsNull,
    #[serde(rename = "IS NOT NULL")]
    NotNull,
    #[serde(rename = "INCLUDES ALL")]
    IncludesAll,
    Includes,
    Excludes,
    #[serde(rename = "MATCHES REGEX")]
    MatchesRegex,
    #[serde(rename = "NOT MATCHES REGEX")]
    NotMatchesRegex,
    #[serde(rename = ">= AND <=")]
    Between,
    #[serde(rename = "< OR >")]
    NotBetween,
}

/// Stash `StringCriterionInput`
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashStringCriterion {
    pub value: String,
    pub modifier: StashCriterionModifier,
}

/// Stash `IntCriterionInput`
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashIntCriterion {
    pub value: i32,
    pub value2: Option<i32>,
    pub modifier: StashCriterionModifier,
}

/// Stash `MultiCriterionInput`
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashMultiCriterion {
    pub value: Option<Vec<String>>,
    pub modifier: StashCriterionModifier,
    pub excludes: Option<Vec<String>>,
}

/// Stash `HierarchicalMultiCriterionInput`
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashHierarchicalMultiCriterion {
    pub value: Option<Vec<String>>,
    pub modifier: StashCriterionModifier,
    pub depth: Option<i32>,
    pub excludes: Option<Vec<String>>,
}

/// Stash `DateCriterionInput` / `TimestampCriterionInput`
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashDateCriterion {
    pub value: String,
    pub value2: Option<String>,
    pub modifier: StashCriterionModifier,
}

/// Stash `PhashDistanceCriterionInput`
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashPhashDistanceCriterion {
    pub value: String,
    pub modifier: StashCriterionModifier,
    pub distance: Option<i32>,
}

/// Stash `StashIDCriterionInput`
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashIdCriterion {
    pub endpoint: Option<String>,
    pub stash_id: Option<String>,
    pub modifier: StashCriterionModifier,
}

/// Stash `StashIDsCriterionInput`
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashIdsCriterion {
    pub endpoint: Option<String>,
    pub stash_ids: Option<Vec<String>>,
    pub modifier: StashCriterionModifier,
}

/// Stash `CustomFieldCriterionInput`（`value` 为 GraphQL `Any`，透传 JSON）
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashCustomFieldCriterion {
    pub field: String,
    #[schema(value_type = Vec<serde_json::Value>)]
    pub value: Vec<StashJsonValue>,
    pub modifier: StashCriterionModifier,
}

/// Stash `ResolutionEnum`
#[typeshare::typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StashResolution {
    VeryLow,
    Low,
    R360p,
    Standard,
    WebHd,
    StandardHd,
    FullHd,
    QuadHd,
    FourK,
    FiveK,
    SixK,
    SevenK,
    EightK,
    Huge,
}

/// Stash `ResolutionCriterionInput`
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashResolutionCriterion {
    pub value: StashResolution,
    pub modifier: StashCriterionModifier,
}

/// Stash `OrientationEnum`
#[typeshare::typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StashOrientation {
    Landscape,
    Portrait,
    Square,
}

/// Stash `OrientationCriterionInput`
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashOrientationCriterion {
    pub value: Vec<StashOrientation>,
}

/// Stash `DuplicationCriterionInput`
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashDuplicationCriterion {
    pub distance: Option<i32>,
    pub phash: Option<bool>,
    pub url: Option<bool>,
    pub stash_id: Option<bool>,
    pub title: Option<bool>,
}

/// Stash GraphQL `SceneFilterType`（字段与官方 schema 对齐，未建模的关联过滤器以 JSON 透传）
#[typeshare::typeshare]
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub struct StashSceneFilterType {
    #[serde(rename = "AND", skip_serializing_if = "Option::is_none")]
    #[schema(no_recursion)]
    pub and: Option<Box<StashSceneFilterType>>,
    #[serde(rename = "OR", skip_serializing_if = "Option::is_none")]
    #[schema(no_recursion)]
    pub or: Option<Box<StashSceneFilterType>>,
    #[serde(rename = "NOT", skip_serializing_if = "Option::is_none")]
    #[schema(no_recursion)]
    pub not: Option<Box<StashSceneFilterType>>,

    pub id: Option<StashIntCriterion>,
    pub title: Option<StashStringCriterion>,
    pub code: Option<StashStringCriterion>,
    pub details: Option<StashStringCriterion>,
    pub director: Option<StashStringCriterion>,

    pub oshash: Option<StashStringCriterion>,
    pub checksum: Option<StashStringCriterion>,
    pub phash: Option<StashStringCriterion>,
    pub phash_distance: Option<StashPhashDistanceCriterion>,
    pub path: Option<StashStringCriterion>,
    pub file_count: Option<StashIntCriterion>,

    pub rating100: Option<StashIntCriterion>,
    pub organized: Option<bool>,
    pub o_counter: Option<StashIntCriterion>,
    pub duplicated: Option<StashDuplicationCriterion>,
    pub resolution: Option<StashResolutionCriterion>,
    pub orientation: Option<StashOrientationCriterion>,
    pub framerate: Option<StashIntCriterion>,
    pub bitrate: Option<StashIntCriterion>,
    pub video_codec: Option<StashStringCriterion>,
    pub audio_codec: Option<StashStringCriterion>,
    pub duration: Option<StashIntCriterion>,

    pub has_markers: Option<String>,
    pub is_missing: Option<String>,

    pub studios: Option<StashHierarchicalMultiCriterion>,
    pub movies: Option<StashMultiCriterion>,
    pub groups: Option<StashHierarchicalMultiCriterion>,
    pub galleries: Option<StashMultiCriterion>,
    pub tags: Option<StashHierarchicalMultiCriterion>,
    pub tag_count: Option<StashIntCriterion>,
    pub performer_tags: Option<StashHierarchicalMultiCriterion>,
    pub performer_favorite: Option<bool>,
    pub performer_age: Option<StashIntCriterion>,
    pub performers: Option<StashMultiCriterion>,
    pub performer_count: Option<StashIntCriterion>,

    pub stash_id_endpoint: Option<StashIdCriterion>,
    pub stash_ids_endpoint: Option<StashIdsCriterion>,
    pub stash_id_count: Option<StashIntCriterion>,
    pub url: Option<StashStringCriterion>,
    pub interactive: Option<bool>,
    pub interactive_speed: Option<StashIntCriterion>,
    pub captions: Option<StashStringCriterion>,
    pub resume_time: Option<StashIntCriterion>,
    pub play_count: Option<StashIntCriterion>,
    pub play_duration: Option<StashIntCriterion>,
    pub last_played_at: Option<StashDateCriterion>,
    pub date: Option<StashDateCriterion>,
    pub created_at: Option<StashDateCriterion>,
    pub updated_at: Option<StashDateCriterion>,

    /// 关联实体过滤器（结构体庞大，按需透传 Stash 原生 JSON）
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<serde_json::Value>)]
    pub galleries_filter: Option<StashJsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<serde_json::Value>)]
    pub performers_filter: Option<StashJsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<serde_json::Value>)]
    pub studios_filter: Option<StashJsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<serde_json::Value>)]
    pub tags_filter: Option<StashJsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<serde_json::Value>)]
    pub movies_filter: Option<StashJsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<serde_json::Value>)]
    pub groups_filter: Option<StashJsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<serde_json::Value>)]
    pub markers_filter: Option<StashJsonValue>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Option<serde_json::Value>)]
    pub files_filter: Option<StashJsonValue>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_fields: Option<Vec<StashCustomFieldCriterion>>,
}
