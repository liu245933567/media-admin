//! 离线导出 OpenAPI JSON，供前端 Orval 生成使用。
//!
//! 用法：`media-admin-openapi [输出路径]`
//! - 无参数或 `-`：写入 stdout
//! - 其它路径：写入对应文件。

use std::{env, fs, io, path::Path};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let doc = ma_api::openapi_json();
    let json = serde_json::to_string_pretty(&doc)?;
    let out = env::args().nth(1);

    match out.as_deref() {
        None | Some("-") => {
            io::Write::write_all(&mut io::stdout(), json.as_bytes())?;
        }
        Some(path) => {
            let path = Path::new(path);
            if let Some(parent) = path.parent()
                && !parent.as_os_str().is_empty()
            {
                fs::create_dir_all(parent)?;
            }
            fs::write(path, json)?;
            eprintln!("wrote {}", path.display());
        }
    }

    Ok(())
}
