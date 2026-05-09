use anyhow::{anyhow, Result};

/// 解析 `STASH_BASE_URL` 为 GraphQL 端点 URL（兼容是否带 `/graphql` 后缀）。
pub fn stash_graphql_url() -> Result<String> {
    let base_url = std::env::var("STASH_BASE_URL")
        .map_err(|_| anyhow!("STASH_BASE_URL is not set"))?
        .trim()
        .to_string();

    let gql_url = if base_url.trim_end_matches('/').ends_with("/graphql") {
        base_url.trim_end_matches('/').to_string()
    } else {
        format!("{}/graphql", base_url.trim_end_matches('/'))
    };
    Ok(gql_url)
}

fn stash_api_key() -> Result<String> {
    Ok(std::env::var("STASH_API_KEY")
        .map_err(|_| anyhow!("STASH_API_KEY is not set"))?
        .trim()
        .to_string())
}

/// 将完整 GraphQL body（含 `query` / `variables` / `operationName` 等）转发到 Stash，返回响应文本。
pub async fn forward_graphql(payload: serde_json::Value) -> Result<String> {
    let gql_url = stash_graphql_url()?;
    let api_key = stash_api_key()?;

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
