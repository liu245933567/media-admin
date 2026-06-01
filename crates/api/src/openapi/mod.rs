//! OpenAPI 文档导出（仅命令行 `media-admin-openapi`，不挂载到 HTTP 服务）。

#[cfg(feature = "openapi")]
mod doc;

/// 导出 OpenAPI JSON，供前端 Orval 离线生成请求与 schema。
#[cfg(feature = "openapi")]
pub fn openapi_json() -> serde_json::Value {
    use utoipa::OpenApi;

    serde_json::to_value(doc::ApiDoc::openapi()).unwrap_or_default()
}
