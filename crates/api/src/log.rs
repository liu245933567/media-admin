use tracing_error::ErrorLayer;
use tracing_subscriber::{fmt, layer::SubscriberExt, registry, util::SubscriberInitExt, EnvFilter};

pub fn init_tracing() {
    // 未设置 RUST_LOG 时，`EnvFilter::from_default_env()` 等价于只放行 error，
    // `tracing::info!` 不会出现在控制台。未设置环境变量时默认用 info；设置了则按 RUST_LOG。
    let env_filter = match std::env::var("RUST_LOG") {
        Ok(_) => EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        Err(_) => EnvFilter::new("info"),
    };

    let fmt_layer = fmt::layer()
        .with_file(true) // 显示文件名
        .with_line_number(true) // 显示行号
        .with_target(false); // 可选：不显示 target

    // debug 用 pretty；release 用紧凑格式（生产）
    #[cfg(debug_assertions)]
    let fmt_layer = fmt_layer.pretty();

    let subscriber = registry()
        .with(env_filter)
        .with(fmt_layer)
        .with(ErrorLayer::default()); // 捕获 SpanTrace

    let _ = subscriber.try_init();
}
