use anyhow::{Result, anyhow};
use ma_utils::config::{get_stash_api_key, get_stash_base_url};
use reqwest::header::HeaderMap;
use bytes::Bytes;

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

/// 代理 Stash 媒体文件（图片/视频等），返回 (headers, bytes, content_type)。
pub async fn proxy_media(path: &str) -> Result<(HeaderMap, Bytes, String)> {
    let base_url = get_stash_base_url()?;
    let api_key = get_stash_api_key()?;

    let url = format!(
        "{}/{}",
        base_url.trim_end_matches('/'),
        path.trim_start_matches('/')
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()?;

    let resp = client.get(&url).header("ApiKey", api_key).send().await?;

    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(anyhow!("stash media http {}: {}", status.as_u16(), text));
    }

    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();

    let headers = resp.headers().clone();
    let bytes = resp.bytes().await?;

    Ok((headers, bytes, content_type))
}
