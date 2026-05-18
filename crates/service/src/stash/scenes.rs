use anyhow::{Result, anyhow};
use ma_utils::config::get_stash_base_url;
use ma_utils::types::PageResult;
use serde::Deserialize;
use serde_json::json;

use crate::stash::StashScenePaths;
use crate::stash::types::StashSceneListReq;

use super::forward_graphql;
use super::types::StashSceneRow;

#[derive(Debug, Deserialize)]
struct FindScenesGraphqlData {
    #[serde(rename = "findScenes")]
    find_scenes: FindScenesPayload,
}

#[derive(Debug, Deserialize)]
struct FindScenesPayload {
    count: i32,
    scenes: Vec<StashSceneRow>,
}

#[derive(Debug, Deserialize)]
struct GraphqlError {
    message: String,
}

/// 调用 Stash `findScenes` 并返回分页列表。
pub async fn list_scenes(req: StashSceneListReq) -> Result<PageResult<StashSceneRow>> {
    let StashSceneListReq {
        filter: input_filter,
        scene_filter: input_scene_filter,
        scene_ids: input_scene_ids,
    } = req;

    let mut filter = json!({
        "page": input_filter.page,
        "per_page": input_filter.page_size,
    });

    let stash_host = get_stash_base_url()?;

    if let Some(q) = input_filter.q.as_deref().filter(|s| !s.is_empty()) {
        filter["q"] = json!(q);
    }
    if let Some(sort) = input_filter.sort.as_deref().filter(|s| !s.is_empty()) {
        filter["sort"] = json!(sort);
    }
    if let Some(direction) = input_filter.direction.as_deref().filter(|s| !s.is_empty()) {
        filter["direction"] = json!(direction);
    }

    let mut variables = serde_json::Map::from_iter([("filter".to_string(), filter)]);
    if let Some(scene_filter) = input_scene_filter {
        variables.insert(
            "scene_filter".to_string(),
            serde_json::to_value(scene_filter)?,
        );
    }
    if let Some(scene_ids) = input_scene_ids {
        variables.insert("scene_ids".to_string(), json!(scene_ids));
    }

    let body = json!({
        "query": FIND_SCENES_QUERY.trim(),
        "variables": variables,
        "operationName": "FindScenes",
    });

    let text = forward_graphql(body).await?;
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

    let payload: FindScenesGraphqlData = serde_json::from_value(data.clone())?;
    let find_scenes = payload.find_scenes;

    Ok(PageResult {
        data: find_scenes
            .scenes
            .into_iter()
            .map(|row| row.with_proxy_paths(&stash_host))
            .collect(),
        total: find_scenes.count,
    })
}

impl StashSceneRow {
    /// 将 paths 中的 Stash 绝对 URL 替换为经本服务代理的路径。
    fn with_proxy_paths(mut self, stash_host: &str) -> Self {
        self.paths = self.paths.with_proxy_hosts(stash_host);
        self
    }
}

impl StashScenePaths {
    fn with_proxy_hosts(self, stash_host: &str) -> Self {
        Self {
            screenshot: replace_stash_host_url(stash_host, &self.screenshot),
            preview: replace_stash_host_url(stash_host, &self.preview),
        }
    }
}

fn replace_stash_host_url(stash_host: &str, origin_url: &str) -> String {
    if !origin_url.starts_with("http://") && !origin_url.starts_with("https://") {
        return origin_url.to_string();
    }

    let result_url = origin_url.replace(stash_host, "");

    format!(
        "/api/stash/media?path={}",
        urlencoding::encode(result_url.as_str())
    )
}

const FIND_SCENES_QUERY: &str = r#"
query FindScenes(
  $filter: FindFilterType
  $scene_filter: SceneFilterType
  $scene_ids: [Int!]
) {
  findScenes(
    filter: $filter
    scene_filter: $scene_filter
    scene_ids: $scene_ids
  ) {
    count
    filesize
    duration
    scenes {
      ...SlimSceneData
      __typename
    }
    __typename
  }
}

fragment SlimSceneData on Scene {
  id
  title
  code
  details
  director
  urls
  date
  rating100
  o_counter
  organized
  interactive
  interactive_speed
  resume_time
  play_duration
  play_count
  files {
    ...VideoFileData
    __typename
  }
  paths {
    screenshot
    preview
    stream
    webp
    vtt
    sprite
    funscript
    interactive_heatmap
    caption
    __typename
  }
  scene_markers {
    id
    title
    seconds
    primary_tag {
      id
      name
      __typename
    }
    __typename
  }
  galleries {
    id
    files {
      path
      __typename
    }
    folder {
      path
      __typename
    }
    title
    __typename
  }
  studio {
    id
    name
    image_path
    __typename
  }
  groups {
    group {
      id
      name
      front_image_path
      __typename
    }
    scene_index
    __typename
  }
  tags {
    id
    name
    __typename
  }
  performers {
    id
    name
    disambiguation
    gender
    favorite
    image_path
    __typename
  }
  stash_ids {
    endpoint
    stash_id
    updated_at
    __typename
  }
  __typename
}

fragment VideoFileData on VideoFile {
  id
  path
  basename
  size
  mod_time
  duration
  video_codec
  audio_codec
  width
  height
  frame_rate
  bit_rate
  fingerprints {
    type
    value
    __typename
  }
  __typename
}
"#;
