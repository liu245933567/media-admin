use std::collections::HashMap;
use std::sync::Arc;

use anyhow::{Result, anyhow, bail};
use tokio::sync::{Mutex, RwLock};
use uuid::Uuid;

use super::ffmpeg::spawn_ffmpeg_job;
use super::staging::reset_staging_dir;
use super::types::{
    DownloadJobStartRes, DownloadProgressSnapshot, FfmpegDownloadStartReq, FfmpegSetupStatusRes,
    WhisperDownloadStartReq, WhisperModelItem, WhisperModelsListRes,
};
use ma_utils::config::{ffmpeg_tool_installed, get_models_dir};

use super::whisper::{ensure_download_parent, spawn_whisper_job};
use crate::setup_download::catalog::whisper_catalog;

#[derive(Clone)]
pub struct SetupDownloadState {
    client: reqwest::Client,
    /// 与「下载前清理」串行，避免并行任务互相删除暂存。
    staging_lock: Arc<Mutex<()>>,
    senders: Arc<RwLock<HashMap<Uuid, tokio::sync::watch::Sender<DownloadProgressSnapshot>>>>,
}

impl SetupDownloadState {
    pub fn new(client: reqwest::Client) -> Self {
        Self {
            client,
            staging_lock: Arc::new(Mutex::new(())),
            senders: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    pub fn list_whisper_models() -> WhisperModelsListRes {
        let models_dir = get_models_dir();
        let items = whisper_catalog()
            .into_iter()
            .map(|m| {
                let local_ready = models_dir.join(&m.filename).is_file();
                WhisperModelItem {
                    id: m.id,
                    label: m.label,
                    filename: m.filename,
                    description: m.description,
                    size_hint: m.size_hint,
                    local_ready,
                }
            })
            .collect();
        WhisperModelsListRes { items }
    }

    pub fn ffmpeg_setup_status() -> FfmpegSetupStatusRes {
        FfmpegSetupStatusRes {
            local_ready: ffmpeg_tool_installed(),
        }
    }

    pub async fn subscribe_job(
        &self,
        job_id: Uuid,
    ) -> Option<tokio::sync::watch::Receiver<DownloadProgressSnapshot>> {
        let map = self.senders.read().await;
        map.get(&job_id).map(|tx| tx.subscribe())
    }

    pub async fn start_whisper_download(
        &self,
        body: WhisperDownloadStartReq,
    ) -> Result<DownloadJobStartRes> {
        let _guard = self.staging_lock.lock().await;

        let item = whisper_catalog()
            .into_iter()
            .find(|m| m.id == body.model_id)
            .ok_or_else(|| anyhow!("未知模型 id: {}", body.model_id))?;

        if get_models_dir().join(&item.filename).is_file() {
            bail!("whisper_download_blocked:already_present");
        }

        ensure_download_parent().await?;
        reset_staging_dir().await?;

        let job_id = Uuid::new_v4();
        let (tx, _rx) = tokio::sync::watch::channel(DownloadProgressSnapshot::default());
        self.senders.write().await.insert(job_id, tx.clone());
        drop(_guard);

        let client = self.client.clone();
        let senders = self.senders.clone();
        let jid = job_id;
        spawn_whisper_job(client, body.model_id, tx.clone());

        tokio::spawn(cleanup_sender_when_idle(senders, jid, tx));

        Ok(DownloadJobStartRes {
            job_id: job_id.to_string(),
        })
    }

    pub async fn start_ffmpeg_download(
        &self,
        _body: FfmpegDownloadStartReq,
    ) -> Result<DownloadJobStartRes> {
        let _guard = self.staging_lock.lock().await;

        if ffmpeg_tool_installed() {
            bail!("ffmpeg_download_blocked:already_present");
        }

        ensure_download_parent().await?;
        reset_staging_dir().await?;

        let job_id = Uuid::new_v4();
        let (tx, _rx) = tokio::sync::watch::channel(DownloadProgressSnapshot::default());
        self.senders.write().await.insert(job_id, tx.clone());
        drop(_guard);

        let client = self.client.clone();
        let senders = self.senders.clone();
        let jid = job_id;
        spawn_ffmpeg_job(client, tx.clone());

        tokio::spawn(cleanup_sender_when_idle(senders, jid, tx));

        Ok(DownloadJobStartRes {
            job_id: job_id.to_string(),
        })
    }
}

/// 进度长期保持为终态后，从表中移除 job（避免内存泄漏）。
async fn cleanup_sender_when_idle(
    senders: Arc<RwLock<HashMap<Uuid, tokio::sync::watch::Sender<DownloadProgressSnapshot>>>>,
    job_id: Uuid,
    progress_tx: tokio::sync::watch::Sender<DownloadProgressSnapshot>,
) {
    let mut rx = progress_tx.subscribe();
    loop {
        if rx.changed().await.is_err() {
            break;
        }
        let last = (*rx.borrow()).clone();
        if last.phase == "done" || last.phase == "error" {
            tokio::time::sleep(std::time::Duration::from_secs(120)).await;
            senders.write().await.remove(&job_id);
            break;
        }
    }
}

pub fn parse_job_id(s: &str) -> Result<Uuid> {
    Uuid::parse_str(s).map_err(|_| anyhow!("非法 job_id"))
}
