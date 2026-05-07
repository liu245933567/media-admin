use axum::{
    extract::rejection::{JsonRejection, QueryRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

fn log_app_error(err: &AppError) {
    match err {
        AppError::BadRequest(m) => {
            tracing::debug!(target: "http_error", kind = "bad_request", msg = %m);
        }
        AppError::NotFound(m) => {
            tracing::debug!(target: "http_error", kind = "not_found", msg = %m);
        }
        AppError::Upstream(m) => {
            tracing::warn!(target: "http_error", kind = "upstream", msg = %m);
        }
        AppError::Validation(m) => {
            tracing::error!(target: "http_error", kind = "validation", msg = %m);
        }
        AppError::InvalidQuery(m) => {
            tracing::error!(target: "http_error", kind = "invalid_query", msg = %m);
        }
        AppError::Internal(e) => {
            tracing::error!(
                target: "http_error",
                kind = "internal",
                error = %format!("{e:#}"),
                "HTTP handler returned internal error"
            );
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("验证失败: {0}")]
    Validation(String),
    #[error("查询参数错误: {0}")]
    InvalidQuery(String),
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Upstream(String),
    #[error("{0}")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        log_app_error(&self);
        let (status, msg) = match &self {
            AppError::BadRequest(m) => (StatusCode::BAD_REQUEST, m.clone()),
            AppError::NotFound(m) => (StatusCode::NOT_FOUND, m.clone()),
            AppError::Upstream(m) => (StatusCode::BAD_GATEWAY, m.clone()),
            AppError::Validation(m) => (StatusCode::BAD_REQUEST, m.clone()),
            AppError::InvalidQuery(m) => (StatusCode::BAD_REQUEST, m.clone()),
            AppError::Internal(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        };
        let body = Json(json!({ "error": msg }));
        (status, body).into_response()
    }
}

impl From<JsonRejection> for AppError {
    fn from(value: JsonRejection) -> Self {
        Self::Validation(value.body_text())
    }
}

impl From<QueryRejection> for AppError {
    fn from(value: QueryRejection) -> Self {
        Self::InvalidQuery(value.body_text())
    }
}
