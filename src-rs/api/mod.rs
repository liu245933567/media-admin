use axum::Router;
use std::sync::Arc;
use tokio::net::TcpListener;
use tower_http::services::{ServeDir, ServeFile};

use crate::{config::Config, db::connect_db, state::AppState};

mod log;
mod middleware;
mod routes;

#[tokio::main]
pub async fn start() {
    log::init_tracing();

    let config = Arc::new(Config::init().unwrap());

    let listener = TcpListener::bind(config.listen).await.unwrap();

    tracing::info!("listening on {}", &config.listen);

    let config = Arc::new(Config::init().unwrap());

    let db = connect_db().await.unwrap();

    let app_state = AppState { db, config };

    let app = Router::new()
        .nest("/api", routes::compose())
        .layer(axum::middleware::from_fn(middleware::request_id))
        .fallback_service(
            ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html")),
        )
        .with_state(app_state);

    axum::serve(listener, app).await.unwrap();
}

type StateRouter = Router<AppState>;
