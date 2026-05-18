mod filter;
mod scenes;
mod types;

use anyhow::{Result, anyhow};
use bytes::Bytes;
use futures::Stream;
use ma_utils::config::{get_stash_api_key, get_stash_base_url};
use reqwest::header::{HeaderMap, HeaderName, CONTENT_TYPE, RANGE};
use std::pin::Pin;

pub use filter::{
    StashCriterionModifier, StashCustomFieldCriterion, StashDateCriterion,
    StashDuplicationCriterion, StashHierarchicalMultiCriterion, StashIdCriterion,
    StashIdsCriterion, StashIntCriterion, StashMultiCriterion, StashOrientation,
    StashOrientationCriterion, StashPhashDistanceCriterion, StashResolution,
    StashResolutionCriterion, StashSceneFilterType, StashStringCriterion,
};
pub use scenes::list_scenes;
pub use types::{StashSceneListReq, StashSceneFile, StashScenePaths, StashSceneRow};

pub type MediaBodyStream =
    Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>>;

pub struct ProxiedMedia {
    pub status: reqwest::StatusCode,
    pub headers: HeaderMap,
    pub body: MediaBodyStream,
}

/// 解析 `STASH_BASE_URL` 为 GraphQL 端点 URL（兼容是否带 `/graphql` 后缀）。
pub fn stash_graphql_url() -> Result<String> {
    let base_url = get_stash_base_url()?;

    let gql_url = if base_url.trim_end_matches('/').ends_with("/graphql") {
        base_url.trim_end_matches('/').to_string()
    } else {
        format!("{}/graphql", base_url.trim_end_matches('/'))
    };
    Ok(gql_url)
}

/// 将完整 GraphQL body（含 `query` / `variables` / `operationName` 等）转发到 Stash，返回响应文本。
pub async fn forward_graphql(payload: serde_json::Value) -> Result<String> {
    let gql_url = stash_graphql_url()?;
    let api_key = get_stash_api_key()?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()?;

    let mut req = client.post(&gql_url).json(&payload);
    req = req.header("ApiKey", api_key);

    let resp = req.send().await?;
    let status = resp.status();
    let text = resp.text().await?;
    if !status.is_success() {
        return Err(anyhow!("stash graphql http {}: {}", status.as_u16(), text));
    }
    Ok(text)
}

/// 将 GraphQL 返回的 path（相对或绝对 URL）解析为可请求的 Stash 媒体地址。
fn resolve_stash_media_url(path: &str) -> Result<String> {
    let path = path.trim();
    if path.is_empty() {
        return Err(anyhow!("stash media path 为空"));
    }

    let lower = path.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        return Ok(path.to_string());
    }

    let base_url = get_stash_base_url()?;
    Ok(format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    ))
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
pub async fn proxy_media(path: &str, request_range: Option<&str>) -> Result<ProxiedMedia> {
    let api_key = get_stash_api_key()?;
    let url = resolve_stash_media_url(path)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    let mut req = client.get(&url).header("ApiKey", api_key);
    if let Some(range) = request_range {
        req = req.header(RANGE, range);
    }

    let resp = req.send().await?;
    let status = resp.status();

    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("stash media http {}: {}", status.as_u16(), text));
    }

    if let Some(ct) = resp.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()) {
        if ct.starts_with("text/html") {
            return Err(anyhow!(
                "stash 返回了 HTML 而非媒体文件，请检查 path 与 STASH_BASE_URL 是否一致: {url}"
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
    use super::resolve_stash_media_url;

    #[test]
    fn resolve_absolute_url_unchanged() {
        let url = "https://stash.example.com:55001/scene/224/preview";
        assert_eq!(resolve_stash_media_url(url).unwrap(), url);
    }
}
