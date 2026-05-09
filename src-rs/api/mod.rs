use axum::Router;
use tokio::net::TcpListener;
use tower_http::services::{ServeDir, ServeFile};

use crate::{log::init_tracing, state::AppState};

mod middleware;
mod routes;

#[tokio::main]
pub async fn start() {
    init_tracing();

    let listen = std::env::var("LISTEN").unwrap_or_else(|_| "0.0.0.0:3000".to_string());

    let listener = TcpListener::bind(&listen).await.unwrap();

    let db = connect_db().await.unwrap();

    let app_state = AppState { db };

    let app = Router::new()
        .nest("/api", routes::compose())
        .layer(axum::middleware::from_fn(middleware::request_id))
        .fallback_service(
            ServeDir::new("dist").not_found_service(ServeFile::new("dist/index.html")),
        )
        .with_state(app_state);

    tracing::info!("listening on {}", &listen.to_string());

    axum::serve(listener, app).await.unwrap();
}

type StateRouter = Router<AppState>;
