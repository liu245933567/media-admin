use std::path::PathBuf;

use media_admin::{
    core::openai::{translate_srt_file, TranslateOptions},
    log::init_tracing,
};

/// 用法:
///   SILICONFLOW_API_KEY=sk-xxx \
///   cargo run --example translate_srt -- <source.srt> [target_language]
///
/// `target_language` 默认 "Chinese"，输出位于源 SRT 同目录下的 `<stem>.<lang>.srt`。
#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();
    init_tracing();

    let mut args = std::env::args().skip(1);
    let src = args
        .next()
        .map(PathBuf::from)
        .expect("缺少 SRT 路径参数: cargo run --example translate_srt -- <source.srt> [language]");
    let lang = args.next().unwrap_or_else(|| "Chinese".to_string());

    let mut opts = TranslateOptions::default();
    opts.target_language = lang;

    let dst = translate_srt_file(&src, None, opts)
        .await
        .expect("翻译失败");

    println!("翻译完成: {}", dst.display());
}
