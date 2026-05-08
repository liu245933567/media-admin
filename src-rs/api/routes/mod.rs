use crate::api::StateRouter;
use axum::{routing::get, Router};
mod fs;
mod sse;
mod subtitle_web;

pub fn compose() -> StateRouter {
    Router::new()
        .nest("/fs", fs::routes())
        .nest("/subtitle-web", subtitle_web::routes())
        .route("/sse", get(sse::sse_handler))
}
