use crate::StateRouter;
use axum::{Router, routing::get};
pub(crate) mod fs;
pub(crate) mod jobs;
pub(crate) mod media_library;
pub(crate) mod settings;
pub(crate) mod setup;
mod sse;
pub(crate) mod stash;
pub(crate) mod subtitle_web;

pub fn compose() -> StateRouter {
    Router::new()
        .nest("/fs", fs::routes())
        .nest("/jobs", jobs::routes())
        .nest("/media-library", media_library::routes())
        .nest("/subtitle-web", subtitle_web::routes())
        .nest("/stash", stash::routes())
        .nest("/settings", settings::routes())
        .nest("/setup", setup::routes())
        .route("/sse", get(sse::sse_handler))
}
