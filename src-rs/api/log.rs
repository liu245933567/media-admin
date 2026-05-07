use tracing_subscriber::{EnvFilter, layer::SubscriberExt, util::SubscriberInitExt};

pub fn init_tracing() {
    // 未设置 RUST_LOG 时，`EnvFilter::from_default_env()` 等价于只放行 error，
    // `tracing::info!` 不会出现在控制台。未设置环境变量时默认用 info；设置了则按 RUST_LOG。
    let filter = match std::env::var("RUST_LOG") {
        Ok(_) => EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        Err(_) => EnvFilter::new("info"),
    };

    tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_file(true)
                .with_line_number(true),
        )
        .init();
}
