mod entities;
mod filter;
mod metadata;
mod path;
mod scenes;
mod types;

use anyhow::{Result, anyhow};
use bytes::Bytes;
use futures::Stream;
use reqwest::header::{CONTENT_TYPE, HeaderMap, HeaderName, RANGE};
use std::pin::Pin;

pub use entities::search_entities;
pub use filter::{
    StashCriterionModifier, StashCustomFieldCriterion, StashDateCriterion,
    StashDuplicationCriterion, StashHierarchicalMultiCriterion, StashIdCriterion,
    StashIdsCriterion, StashIntCriterion, StashMultiCriterion, StashOrientation,
    StashOrientationCriterion, StashPhashDistanceCriterion, StashResolution,
    StashResolutionCriterion, StashSceneFilterType, StashStringCriterion,
};
pub use path::{StashPathMapping, map_stash_file_path};
pub use scenes::{list_mapped_video_paths_without_captions, list_scenes};
pub use types::{
    StashConnectConfig, StashEntityKind, StashEntitySearchItem, StashEntitySearchReq,
    StashEntitySearchRes, StashFilter, StashSceneFile, StashSceneListReq, StashScenePaths,
    StashSceneRow,
};

pub type MediaBodyStream = Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>;

pub struct ProxiedMedia {
    pub status: reqwest::StatusCode,
    pub headers: HeaderMap,
    pub body: MediaBodyStream,
}

/// 校验 Stash 连接配置是否可用于请求。
pub fn ensure_stash_config(cfg: &StashConnectConfig) -> Result<()> {
    if cfg.base_url.trim().is_empty() {
        return Err(anyhow!(
            "未配置 Stash 服务地址，请在设置页填写 Stash Base URL"
        ));
    }
    Ok(())
}

fn normalized_base_url(cfg: &StashConnectConfig) -> Result<String> {
    ensure_stash_config(cfg)?;
    Ok(cfg.base_url.trim().trim_end_matches('/').to_string())
}

/// 解析 Stash 根地址为 GraphQL 端点 URL（兼容是否带 `/graphql` 后缀）。
pub fn stash_graphql_url(cfg: &StashConnectConfig) -> Result<String> {
    let base_url = normalized_base_url(cfg)?;
    let gql_url = if base_url.ends_with("/graphql") {
        base_url
    } else {
        format!("{base_url}/graphql")
    };
    Ok(gql_url)
}

/// 将完整 GraphQL body（含 `query` / `variables` / `operationName` 等）转发到 Stash，返回响应文本。
pub async fn forward_graphql(
    cfg: &StashConnectConfig,
    payload: serde_json::Value,
) -> Result<String> {
    let gql_url = stash_graphql_url(cfg)?;
    let api_key = cfg.api_key.trim();

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let mut req = client.post(&gql_url).json(&payload);
    if !api_key.is_empty() {
        req = req.header("ApiKey", api_key);
    }

    let resp = req.send().await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(anyhow!("stash graphql http {}: {}", status.as_u16(), text));
    }
    Ok(text)
}

/// 将 GraphQL 返回的 path（相对或绝对 URL）解析为可请求的 Stash 媒体地址。
pub fn resolve_stash_media_url(cfg: &StashConnectConfig, path: &str) -> Result<String> {
    let path = path.trim();
    if path.is_empty() {
        return Err(anyhow!("stash media path 为空"));
    }

    let lower = path.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Ok(path.to_string());
    }

    let base_url = normalized_base_url(cfg)?;
    Ok(format!("{base_url}/{}", path.trim_start_matches('/')))
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

/// 流式代理 Stash 媒体，转发客户端 `Range` 以支持视频 seek。
pub async fn proxy_media(
    cfg: &StashConnectConfig,
    path: &str,
    request_range: Option<&str>,
) -> Result<ProxiedMedia> {
    ensure_stash_config(cfg)?;
    let api_key = cfg.api_key.trim();
    let url = resolve_stash_media_url(cfg, path)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    let mut req = client.get(&url);
    if !api_key.is_empty() {
        req = req.header("ApiKey", api_key);
    }
    if let Some(range) = request_range {
        req = req.header(RANGE, range);
    }

    let resp = req.send().await?;
    let status = resp.status();

    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("stash media http {}: {}", status.as_u16(), text));
    }

    if let Some(ct) = resp
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
    {
        if ct.starts_with("text/html") {
            return Err(anyhow!(
                "stash 返回了 HTML 而非媒体文件，请检查 path 与 Stash Base URL 是否一致: {url}"
            ));
        }
    }

    let mut headers = HeaderMap::new();
    for (name, value) in resp.headers().iter() {
        if forward_response_header(name) {
            headers.insert(name.clone(), value.clone());
        }
    }

    let body: MediaBodyStream = Box::pin(resp.bytes_stream());

    Ok(ProxiedMedia {
        status,
        headers,
        body,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_cfg() -> StashConnectConfig {
        StashConnectConfig {
            base_url: "https://stash.example.com:55001".to_string(),
            api_key: String::new(),
            path_mappings: Vec::new(),
        }
    }

    #[test]
    fn resolve_absolute_url_unchanged() {
        let url = "https://stash.example.com:55001/scene/224/preview";
        assert_eq!(resolve_stash_media_url(&test_cfg(), url).unwrap(), url);
    }
}
pub use metadata::{
    StashIdentifyFieldOption, StashIdentifyFieldStrategy, StashIdentifySource,
    StashSceneMetadataCompleteReq, StashSceneMetadataCompleteRes, complete_scene_metadata,
};
