//! 本地视频文件 HTTP Range 流式读取。

use std::{io, path::PathBuf, pin::Pin};

use anyhow::{Context, Result, bail};
use bytes::Bytes;
use futures::Stream;
use reqwest::header::{HeaderMap, HeaderValue, ACCEPT_RANGES, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

use crate::media_paths::{is_video_file, video_mime_type};

pub type VideoBodyStream =
    Pin<Box<dyn Stream<Item = Result<Bytes, io::Error>> + Send>>;

/// 本地视频流响应（供 API 层组装 axum Response）。
pub struct LocalVideoStream {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: VideoBodyStream,
}

struct ByteRange {
    start: u64,
    end: u64,
}

/// 校验并打开本地视频，按 `Range` 读取字节流。
pub async fn stream_local_video(path: String, range_header: Option<&str>) -> Result<LocalVideoStream> {
    let p = PathBuf::from(path.trim());
    if !p.is_absolute() {
        bail!("path 必须为绝对路径");
    }
    if !tokio::fs::try_exists(&p).await? {
        bail!("path 不存在");
    }
    let meta = tokio::fs::metadata(&p).await?;
    if !meta.is_file() {
        bail!("path 不能为目录");
    }
    if !is_video_file(&p) {
        bail!("不支持的视频文件类型");
    }

    let file_len = meta.len();
    let mime = video_mime_type(&p);

    let (start, end) = if let Some(hdr) = range_header {
        let br = parse_range_header(hdr, file_len)?;
        (br.start, br.end)
    } else {
        (0, file_len.saturating_sub(1))
    };

    let content_len = end
        .checked_sub(start)
        .and_then(|n| n.checked_add(1))
        .context("无效的 Range 范围")?;

    let mut file = tokio::fs::File::open(&p).await?;
    file.seek(io::SeekFrom::Start(start)).await?;

    let reader = file.take(content_len);
    let body: VideoBodyStream = Box::pin(ReaderStream::new(reader));

    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static(mime));
    headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&content_len.to_string()).context("Content-Length")?,
    );

    let status = if range_header.is_some() {
        headers.insert(
            CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {start}-{end}/{file_len}"))
                .context("Content-Range")?,
        );
        206
    } else {
        200
    };

    Ok(LocalVideoStream {
        status,
        headers,
        body,
    })
}

/// 解析 `Range: bytes=start-end`（单段）。
fn parse_range_header(range: &str, file_len: u64) -> Result<ByteRange> {
    let range = range.trim();
    let Some(spec) = range.strip_prefix("bytes=") else {
        bail!("不支持的 Range 格式");
    };
    if file_len == 0 {
        bail!("空文件无法 Range");
    }

    let parts: Vec<&str> = spec.splitn(2, '-').collect();
    if parts.len() != 2 {
        bail!("不支持的 Range 格式");
    }

    let start = if parts[0].is_empty() {
        let suffix: u64 = parts[1]
            .parse()
            .context("Range 后缀长度无效")?;
        file_len.saturating_sub(suffix)
    } else {
        parts[0].parse().context("Range 起始无效")?
    };

    let end = if parts[1].is_empty() {
        file_len - 1
    } else {
        parts[1].parse().context("Range 结束无效")?
    };

    if start >= file_len {
        bail!("Range 起始超出文件大小");
    }
    let end = end.min(file_len - 1);
    if start > end {
        bail!("Range 起始大于结束");
    }

    Ok(ByteRange { start, end })
}

#[cfg(test)]
mod tests {
    use super::parse_range_header;

    #[test]
    fn parse_bytes_range() {
        let r = parse_range_header("bytes=0-99", 1000).unwrap();
        assert_eq!(r.start, 0);
        assert_eq!(r.end, 99);
    }

    #[test]
    fn parse_open_ended() {
        let r = parse_range_header("bytes=500-", 1000).unwrap();
        assert_eq!(r.start, 500);
        assert_eq!(r.end, 999);
    }
}
