use std::path::PathBuf;
use std::time::{Duration, Instant};

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// 从 `http://host:port/...` 得到 `host:port`，供 `TcpStream::connect` 使用。
fn tcp_addr_from_http_url(web_url: &str) -> Option<String> {
    let s = web_url.trim().trim_end_matches('/');
    let https = s.starts_with("https://");
    let rest = s
        .strip_prefix("http://")
        .or_else(|| s.strip_prefix("https://"))?;
    if let Some((host, port_str)) = rest.rsplit_once(':') {
        let port: u16 = port_str.parse().ok()?;
        return Some(format!("{host}:{port}"));
    }
    let port = if https { 443 } else { 80 };
    Some(format!("{rest}:{port}"))
}

/// 开发模式下在 **Rust setup 里手动创建窗口** 时，不会走 Tauri 对 `devUrl` 的就绪等待，
/// WebView 往往在 Vite 尚未监听前加载 → 表现为「找不到 localhost 页面」。这里阻塞直至端口可连。
#[cfg(debug_assertions)]
fn wait_for_dev_server(web_url: &str) -> Result<(), String> {
    let addr = tcp_addr_from_http_url(web_url)
        .ok_or_else(|| format!("cannot parse dev server URL: {web_url}"))?;
    let timeout = Duration::from_secs(120);
    let started = Instant::now();
    loop {
        if std::net::TcpStream::connect(&addr).is_ok() {
            tracing::info!("dev server reachable at {addr}");
            return Ok(());
        }
        if started.elapsed() > timeout {
            return Err(format!(
                "timed out waiting for dev server at {addr} ({timeout:?}). \
                 Check beforeDevCommand / Vite port (see vite.config server.port)."
            ));
        }
        std::thread::sleep(Duration::from_millis(150));
    }
}

/// `apps/desktop` → 仓库根目录（与 Axum `dist/`、`static/` 相对路径约定一致）
fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("resolve repository root from apps/desktop/Cargo.toml")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let workspace = workspace_root();
    if std::env::set_current_dir(&workspace).is_err() {
        eprintln!(
            "warning: failed to chdir to {}; cwd-relative dist/static may break",
            workspace.display()
        );
    }
    dotenvy::dotenv().ok();

    // 默认已包含 Stdout + Webview；需 `with_default_subscriber` 才会安装全局 subscriber（含文件）
    let tracing_plugin = tauri_plugin_tracing::Builder::new()
        .with_file_logging()
        .with_default_subscriber()
        .build();

    tauri::Builder::default()
        .plugin(tracing_plugin)
        .setup(|app| {
            let listen = std::env::var("LISTEN").unwrap_or_else(|_| "127.0.0.1:3000".to_string());

            let addr = tauri::async_runtime::block_on(ma_api::spawn_server(&listen))
                .map_err(|e| format!("failed to start API server: {e:#}"))?;

            // Windows 上 `localhost` 可能解析到 ::1，而 Vite 默认仅监听 IPv4 → 用 127.0.0.1 更稳
            let web_url = if cfg!(debug_assertions) {
                std::env::var("TAURI_WEB_URL")
                    .unwrap_or_else(|_| "http://127.0.0.1:5173/".to_string())
            } else {
                format!("http://127.0.0.1:{}/", addr.port())
            };

            #[cfg(debug_assertions)]
            wait_for_dev_server(&web_url)?;

            WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(
                    web_url
                        .parse()
                        .map_err(|e| format!("invalid web URL {web_url:?}: {e}"))?,
                ),
            )
            .title("Media Admin")
            .inner_size(1280.0, 800.0)
            .build()
            .map_err(|e| format!("failed to create main window: {e}"))?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
