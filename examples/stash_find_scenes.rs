use anyhow::Result;
use media_admin::{core::stash::forward_graphql, log::init_tracing};

/// 用法：
///   设置环境变量：
///     STASH_BASE_URL=https://your-stash-host:port
///     STASH_API_KEY=your_api_key
///   然后运行：
///     cargo run --example stash_find_scenes
///
/// 完整 GraphQL body 在示例内组装（与前端同理）；生产路径请走 HTTP `/api/stash/graphql`。
#[tokio::main]
async fn main() -> Result<()> {
    let _ = dotenvy::dotenv();
    init_tracing();

    let query = r#"
        query MyQuery($filter: FindFilterType) {
            findScenes(filter: $filter) {
                count
                scenes {
                    id
                    title
                    date
                    files {
                        path
                        basename
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
                    }
                }
            }
        }"#;

    let body = serde_json::json!({
        "query": query,
        "variables": {
            "filter": {
                "page": 1,
                "per_page": 50,
                "sort": "title",
                "direction": "ASC"
            }
        }
    });

    let text = forward_graphql(body).await?;
    tracing::info!("stash graphql response: {text}");

    Ok(())
}
