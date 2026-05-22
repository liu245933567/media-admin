use crate::StateRouter;
use axum::{Router, routing::get};
mod fs;
mod jobs;
mod media_library;
mod settings;
mod setup;
mod sse;
mod stash;
mod subtitle_web;
mod video_folder_scan;

pub fn compose() -> StateRouter {
    Router::new()
        .nest("/fs", fs::routes())
        .nest("/jobs", jobs::routes())
        .nest("/media-library", media_library::routes())
        .nest("/subtitle-web", subtitle_web::routes())
        .nest("/video-folder", video_folder_scan::routes())
        .nest("/stash", stash::routes())
        .nest("/settings", settings::routes())
        .nest("/setup", setup::routes())
        .route("/sse", get(sse::sse_handler))
}
