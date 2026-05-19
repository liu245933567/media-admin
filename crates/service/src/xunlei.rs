use anyhow::Result;
use base64::{Engine, engine::general_purpose::STANDARD as B64};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::path::Path;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

const CHUNK: usize = 0x5000;
const TOTAL: usize = 0xf000;

/// 与 Jellyfin MeiamSub ThunderProvider.GetCidByFileAsync 对齐：分段采样后 SHA1，再转大写十六进制。
pub async fn thunder_cid_from_file(path: &Path) -> Result<String> {
    let meta = tokio::fs::metadata(path).await?;
    let file_size = meta.len() as usize;

    let mut file = tokio::fs::File::open(path).await?;

    let mut buf = vec![0u8; TOTAL];

    let digest = if file_size < TOTAL {
        file.read_exact(&mut buf[..file_size]).await?;
        let mut hasher = Sha1::new();
        hasher.update(&buf[..file_size]);
        hasher.finalize()
    } else {
        file.read_exact(&mut buf[..CHUNK]).await?;
        file.seek(std::io::SeekFrom::Start((file_size / 3) as u64))
            .await?;
        file.read_exact(&mut buf[CHUNK..CHUNK * 2]).await?;
        file.seek(std::io::SeekFrom::Start((file_size - CHUNK) as u64))
            .await?;
        file.read_exact(&mut buf[CHUNK * 2..TOTAL]).await?;
        let mut hasher = Sha1::new();
        hasher.update(&buf[..]);
        hasher.finalize()
    };

    Ok(hex::encode_upper(digest.as_slice()))
}

#[derive(Debug, Deserialize)]
pub struct OracleSubtitleRoot {
    pub code: i32,
    pub data: Option<Vec<OracleSubtitleItem>>,
    pub result: Option<String>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct OracleSubtitleItem {
    // pub gcid: Option<String>,
    pub cid: Option<String>,
    pub url: Option<String>,
    pub ext: Option<String>,
    pub name: Option<String>,
    // pub duration: Option<i32>,
    pub languages: Option<Vec<String>>,
    // pub source: Option<i32>,
    // pub score: Option<i32>,
    // #[serde(default)]
    // pub fingerprintf_score: Option<i32>,
    // pub extra_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DownloadPayload {
    pub url: String,
    pub format: String,
    #[serde(default)]
    pub language: Option<String>,
    #[serde(default)]
    pub two_letter_iso_language_name: Option<String>,
}

pub fn encode_subtitle_id(payload: &DownloadPayload) -> Result<String> {
    let json = serde_json::to_string(payload)?;
    Ok(B64.encode(json.as_bytes()))
}

pub fn decode_subtitle_id(id: &str) -> Result<DownloadPayload> {
    let bytes = B64.decode(id.trim())?;
    let s = String::from_utf8(bytes)?;
    Ok(serde_json::from_str(&s)?)
}

#[derive(Clone)]
pub struct ThunderSubtitleClient {
    pub base_url: &'static str,
    pub client: reqwest::Client,
}

impl ThunderSubtitleClient {
    pub fn new() -> Result<Self> {
        let base_url = "https://api-shoulei-ssl.xunlei.com/oracle/subtitle";

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .build()?;

        Ok(Self { base_url, client })
    }

    /// 与 MeiamSub `oracle/subtitle?name={filename}` 一致。
    pub async fn search_by_filename(&self, filename: &str) -> Result<OracleSubtitleRoot> {
        let url = format!(
            "{}?name={}",
            self.base_url.trim_end_matches('/'),
            urlencoding::encode(filename)
        );
        let text = self
            .client
            .get(&url)
            .send()
            .await?
            .error_for_status()?
            .text()
            .await?;

        let root: OracleSubtitleRoot = serde_json::from_str(&text)?;
        Ok(root)
    }

    pub async fn download_bytes(&self, url: &str) -> Result<Vec<u8>> {
        let bytes = self
            .client
            .get(url)
            .send()
            .await?
            .error_for_status()?
            .bytes()
            .await?;
        Ok(bytes.to_vec())
    }
}
