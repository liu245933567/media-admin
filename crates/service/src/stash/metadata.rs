use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use serde_json::json;
use utoipa::ToSchema;

use super::forward_graphql;
use super::types::StashConnectConfig;

const INCOMPLETE_METADATA_PAGE_SIZE: i32 = 500;

fn default_identify_sources() -> Vec<StashIdentifySource> {
    vec![
        StashIdentifySource::stash_box_endpoint("https://stashdb.org/graphql"),
        StashIdentifySource::stash_box_endpoint("https://theporndb.net/graphql"),
    ]
}

fn default_field_options() -> Vec<StashIdentifyFieldOption> {
    vec![
        StashIdentifyFieldOption::merge("title"),
        StashIdentifyFieldOption::merge("details"),
        StashIdentifyFieldOption::merge("date"),
        StashIdentifyFieldOption::merge("urls"),
        StashIdentifyFieldOption::merge("studio").with_create_missing(true),
        StashIdentifyFieldOption::merge("performers").with_create_missing(true),
        StashIdentifyFieldOption::merge("tags").with_create_missing(true),
    ]
}

/// Stash 元数据识别字段写入策略。
#[typeshare::typeshare]
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum StashIdentifyFieldStrategy {
    /// 不写入该字段。
    Ignore,
    /// 多值字段合并；单值字段仅在为空时写入。
    Merge,
    /// 找到结果时总是覆盖该字段。
    Overwrite,
}

/// Stash 元数据补全的单个字段策略。
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashIdentifyFieldOption {
    /// 字段名，与 Stash `IdentifyFieldOptionsInput.field` 保持一致。
    pub field: String,
    /// 字段写入策略。
    pub strategy: StashIdentifyFieldStrategy,
    /// 演员、标签、工作室等关联对象不存在时是否创建。
    #[serde(
        default,
        rename = "createMissing",
        alias = "create_missing",
        skip_serializing_if = "Option::is_none"
    )]
    pub create_missing: Option<bool>,
}

impl StashIdentifyFieldOption {
    fn merge(field: &str) -> Self {
        Self {
            field: field.to_string(),
            strategy: StashIdentifyFieldStrategy::Merge,
            create_missing: None,
        }
    }

    fn with_create_missing(mut self, create_missing: bool) -> Self {
        self.create_missing = Some(create_missing);
        self
    }
}

/// Stash 元数据识别来源，可指向 StashBox 端点或本地 scraper。
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashIdentifySource {
    /// StashBox GraphQL 端点，例如 `https://stashdb.org/graphql`。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stash_box_endpoint: Option<String>,
    /// 本地 scraper ID，例如 ThePornDB scraper 的 ID。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scraper_id: Option<String>,
}

impl StashIdentifySource {
    fn stash_box_endpoint(endpoint: &str) -> Self {
        Self {
            stash_box_endpoint: Some(endpoint.to_string()),
            scraper_id: None,
        }
    }
}

/// Stash 场景元数据补全请求。
#[typeshare::typeshare]
#[derive(Debug, Clone, Deserialize, ToSchema)]
pub struct StashSceneMetadataCompleteReq {
    /// 要补全的 Stash 场景 ID；不传时自动查询所有已整理但缺标题或缺演员的场景。
    #[serde(default)]
    pub scene_ids: Vec<String>,
    /// 识别来源，按顺序尝试；不传时默认 StashDB -> ThePornDB。
    #[serde(default = "default_identify_sources")]
    pub sources: Vec<StashIdentifySource>,
    /// 字段策略；不传时只补空字段并合并关联实体。
    #[serde(default = "default_field_options")]
    pub field_options: Vec<StashIdentifyFieldOption>,
    /// 是否设置封面图。
    #[serde(default = "default_true")]
    pub set_cover_image: bool,
    /// 是否将场景标记为已整理。
    #[serde(default)]
    pub set_organized: bool,
    /// 多个匹配结果时跳过，降低误写入风险。
    #[serde(default = "default_true")]
    pub skip_multiple_matches: bool,
    /// 是否跳过单名演员；Stash 默认会跳过，自动补全时关闭以贴近手动刮削结果。
    #[serde(default)]
    pub skip_single_name_performers: bool,
}

/// Stash 场景元数据补全响应。
#[typeshare::typeshare]
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct StashSceneMetadataCompleteRes {
    /// Stash 创建的元数据识别任务 ID；没有命中场景时为空。
    #[serde(default)]
    pub job_id: Option<String>,
    /// 本次提交的场景数量。
    pub scene_count: usize,
}

#[derive(Debug, Deserialize)]
struct FindIncompleteMetadataScenesGraphqlData {
    #[serde(rename = "findScenes")]
    find_scenes: FindIncompleteMetadataScenesPayload,
}

#[derive(Debug, Deserialize)]
struct FindIncompleteMetadataScenesPayload {
    count: i32,
    scenes: Vec<FindIncompleteMetadataScene>,
}

#[derive(Debug, Deserialize)]
struct FindIncompleteMetadataScene {
    id: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    performers: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct MetadataIdentifyGraphqlData {
    #[serde(rename = "metadataIdentify")]
    metadata_identify: String,
}

#[derive(Debug, Deserialize)]
struct GraphqlError {
    message: String,
}

/// 调用 Stash `metadataIdentify`，批量补全场景标题、描述、封面等元数据。
pub async fn complete_scene_metadata(
    cfg: &StashConnectConfig,
    req: StashSceneMetadataCompleteReq,
) -> Result<StashSceneMetadataCompleteRes> {
    if req.sources.is_empty() {
        return Err(anyhow!("至少需要配置一个元数据识别来源"));
    }
    if req.sources.iter().any(|source| !source.is_valid()) {
        return Err(anyhow!(
            "元数据识别来源必须且只能配置 stash_box_endpoint 或 scraper_id"
        ));
    }

    let scene_ids = resolve_scene_ids_for_metadata_completion(cfg, req.scene_ids).await?;
    if scene_ids.is_empty() {
        return Ok(StashSceneMetadataCompleteRes {
            job_id: None,
            scene_count: 0,
        });
    }

    let input = json!({
        "sceneIDs": scene_ids,
        "sources": req.sources.into_iter().map(|source| {
            json!({
                "source": source,
            })
        }).collect::<Vec<_>>(),
        "options": {
            "fieldOptions": req.field_options,
            "setCoverImage": req.set_cover_image,
            "setOrganized": req.set_organized,
            "skipMultipleMatches": req.skip_multiple_matches,
            "skipSingleNamePerformers": req.skip_single_name_performers,
        },
    });

    let body = json!({
        "query": METADATA_IDENTIFY_MUTATION.trim(),
        "variables": {
            "input": input,
        },
        "operationName": "MetadataIdentify",
    });

    let text = forward_graphql(cfg, body).await?;
    let envelope: serde_json::Value = serde_json::from_str(&text)?;

    if let Some(errors) = envelope.get("errors").and_then(|v| v.as_array()) {
        if !errors.is_empty() {
            let parsed: Vec<GraphqlError> = serde_json::from_value(json!(errors))?;
            let msg = parsed
                .into_iter()
                .map(|e| e.message)
                .collect::<Vec<_>>()
                .join("; ");
            return Err(anyhow!(msg));
        }
    }

    let data = envelope
        .get("data")
        .ok_or_else(|| anyhow!("stash graphql 响应缺少 data"))?;
    let data: MetadataIdentifyGraphqlData = serde_json::from_value(data.clone())?;

    Ok(StashSceneMetadataCompleteRes {
        job_id: Some(data.metadata_identify),
        scene_count: scene_ids.len(),
    })
}

async fn resolve_scene_ids_for_metadata_completion(
    cfg: &StashConnectConfig,
    input_scene_ids: Vec<String>,
) -> Result<Vec<String>> {
    let scene_ids = input_scene_ids
        .into_iter()
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect::<Vec<_>>();

    if !scene_ids.is_empty() {
        return Ok(scene_ids);
    }

    find_organized_scene_ids_with_incomplete_metadata(cfg).await
}

async fn find_organized_scene_ids_with_incomplete_metadata(
    cfg: &StashConnectConfig,
) -> Result<Vec<String>> {
    let mut page = 1;
    let mut scene_ids = Vec::new();
    let mut fetched_count = 0usize;

    loop {
        let body = json!({
            "query": FIND_INCOMPLETE_METADATA_SCENES_QUERY.trim(),
            "variables": {
                "filter": {
                    "page": page,
                    "per_page": INCOMPLETE_METADATA_PAGE_SIZE,
                    "sort": "id",
                    "direction": "ASC",
                },
                "scene_filter": {
                    "organized": true,
                },
            },
            "operationName": "FindIncompleteMetadataScenes",
        });

        let text = forward_graphql(cfg, body).await?;
        let envelope: serde_json::Value = serde_json::from_str(&text)?;
        ensure_no_graphql_errors(&envelope)?;

        let data = envelope
            .get("data")
            .ok_or_else(|| anyhow!("stash graphql 响应缺少 data"))?;
        let payload: FindIncompleteMetadataScenesGraphqlData =
            serde_json::from_value(data.clone())?;

        let page_scenes = payload.find_scenes.scenes;
        if page_scenes.is_empty() {
            break;
        }
        fetched_count += page_scenes.len();

        scene_ids.extend(
            page_scenes
                .into_iter()
                .filter(|scene| scene.has_incomplete_metadata())
                .map(|scene| scene.id),
        );

        if fetched_count >= payload.find_scenes.count.max(0) as usize {
            break;
        }
        page += 1;
    }

    Ok(scene_ids)
}

impl FindIncompleteMetadataScene {
    fn has_incomplete_metadata(&self) -> bool {
        self.is_missing_title() || self.performers.is_empty()
    }

    fn is_missing_title(&self) -> bool {
        self.title
            .as_deref()
            .map(str::trim)
            .is_none_or(str::is_empty)
    }
}

fn ensure_no_graphql_errors(envelope: &serde_json::Value) -> Result<()> {
    if let Some(errors) = envelope.get("errors").and_then(|v| v.as_array()) {
        if !errors.is_empty() {
            let parsed: Vec<GraphqlError> = serde_json::from_value(json!(errors))?;
            let msg = parsed
                .into_iter()
                .map(|e| e.message)
                .collect::<Vec<_>>()
                .join("; ");
            return Err(anyhow!(msg));
        }
    }

    Ok(())
}

fn default_true() -> bool {
    true
}

impl StashIdentifySource {
    fn is_valid(&self) -> bool {
        let has_stash_box_endpoint = self
            .stash_box_endpoint
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());
        let has_scraper_id = self
            .scraper_id
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());

        has_stash_box_endpoint != has_scraper_id
    }
}

const METADATA_IDENTIFY_MUTATION: &str = r#"
mutation MetadataIdentify($input: IdentifyMetadataInput!) {
  metadataIdentify(input: $input)
}
"#;

const FIND_INCOMPLETE_METADATA_SCENES_QUERY: &str = r#"
query FindIncompleteMetadataScenes(
  $filter: FindFilterType
  $scene_filter: SceneFilterType
) {
  findScenes(
    filter: $filter
    scene_filter: $scene_filter
  ) {
    count
    scenes {
      id
      title
      performers {
        id
      }
    }
  }
}
"#;
