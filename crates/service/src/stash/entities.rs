use anyhow::{Result, anyhow};
use serde::Deserialize;
use serde_json::json;

use super::forward_graphql;
use super::types::{
    StashConnectConfig, StashEntityKind, StashEntitySearchItem, StashEntitySearchReq,
    StashEntitySearchRes,
};

#[derive(Debug, Deserialize)]
struct EntitySearchEnvelope {
    data: Option<EntitySearchData>,
    #[serde(default)]
    errors: Vec<GraphqlError>,
}

#[derive(Debug, Deserialize)]
struct EntitySearchData {
    #[serde(rename = "findStudios")]
    find_studios: Option<FindStudiosPayload>,
    #[serde(rename = "findPerformers")]
    find_performers: Option<FindPerformersPayload>,
    #[serde(rename = "findTags")]
    find_tags: Option<FindTagsPayload>,
}

#[derive(Debug, Deserialize)]
struct FindStudiosPayload {
    #[serde(default)]
    studios: Vec<StudioNode>,
}

#[derive(Debug, Deserialize)]
struct FindPerformersPayload {
    #[serde(default)]
    performers: Vec<PerformerNode>,
}

#[derive(Debug, Deserialize)]
struct FindTagsPayload {
    #[serde(default)]
    tags: Vec<TagNode>,
}

#[derive(Debug, Deserialize)]
struct StudioNode {
    id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct PerformerNode {
    id: String,
    name: String,
    disambiguation: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TagNode {
    id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct GraphqlError {
    message: String,
}

/// 搜索 Stash 工作室、演员或标签实体。
pub async fn search_entities(
    cfg: &StashConnectConfig,
    req: StashEntitySearchReq,
) -> Result<StashEntitySearchRes> {
    let page_size = req.page_size.clamp(1, 100);
    let filter = json!({
        "page": 1,
        "per_page": page_size,
        "q": req.q.as_deref().unwrap_or("").trim(),
        "sort": "name",
        "direction": "ASC",
    });

    let (query, operation_name) = match req.kind {
        StashEntityKind::Studio => (FIND_STUDIOS_QUERY, "FindStudios"),
        StashEntityKind::Performer => (FIND_PERFORMERS_QUERY, "FindPerformers"),
        StashEntityKind::Tag => (FIND_TAGS_QUERY, "FindTags"),
    };

    let body = json!({
        "query": query.trim(),
        "variables": { "filter": filter },
        "operationName": operation_name,
    });

    let text = forward_graphql(cfg, body).await?;
    let envelope: EntitySearchEnvelope = serde_json::from_str(&text)?;

    if !envelope.errors.is_empty() {
        let msg = envelope
            .errors
            .into_iter()
            .map(|e| e.message)
            .collect::<Vec<_>>()
            .join("; ");
        return Err(anyhow!(msg));
    }

    let data = envelope
        .data
        .ok_or_else(|| anyhow!("stash graphql 响应缺少 data"))?;

    let items = match req.kind {
        StashEntityKind::Studio => data
            .find_studios
            .map(|payload| {
                payload
                    .studios
                    .into_iter()
                    .map(|item| StashEntitySearchItem {
                        id: item.id,
                        name: item.name,
                        disambiguation: None,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        StashEntityKind::Performer => data
            .find_performers
            .map(|payload| {
                payload
                    .performers
                    .into_iter()
                    .map(|item| StashEntitySearchItem {
                        id: item.id,
                        name: item.name,
                        disambiguation: item.disambiguation,
                    })
                    .collect()
            })
            .unwrap_or_default(),
        StashEntityKind::Tag => data
            .find_tags
            .map(|payload| {
                payload
                    .tags
                    .into_iter()
                    .map(|item| StashEntitySearchItem {
                        id: item.id,
                        name: item.name,
                        disambiguation: None,
                    })
                    .collect()
            })
            .unwrap_or_default(),
    };

    Ok(StashEntitySearchRes { items })
}

const FIND_STUDIOS_QUERY: &str = r#"
query FindStudios($filter: FindFilterType) {
  findStudios(filter: $filter) {
    studios {
      id
      name
      __typename
    }
    __typename
  }
}
"#;

const FIND_PERFORMERS_QUERY: &str = r#"
query FindPerformers($filter: FindFilterType) {
  findPerformers(filter: $filter) {
    performers {
      id
      name
      disambiguation
      __typename
    }
    __typename
  }
}
"#;

const FIND_TAGS_QUERY: &str = r#"
query FindTags($filter: FindFilterType) {
  findTags(filter: $filter) {
    tags {
      id
      name
      __typename
    }
    __typename
  }
}
"#;
