use crate::StateRouter;
use axum::{routing::get, Router};
mod fs;
mod setup;
mod sse;
mod stash;
mod subtitle_task;
mod subtitle_translate_task;
mod subtitle_web;
mod video_folder_scan;

pub fn compose() -> StateRouter {
    Router::new()
        .nest("/fs", fs::routes())
        .nest("/subtitle-task", subtitle_task::routes())
        .nest("/subtitle-translate-task", subtitle_translate_task::routes())
        .nest("/subtitle-web", subtitle_web::routes())
        .nest("/video-folder", video_folder_scan::routes())
        .nest("/stash", stash::routes())
        .nest("/setup", setup::routes())
        .route("/sse", get(sse::sse_handler))
}
