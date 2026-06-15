use std::sync::{Arc, OnceLock};

use tokio::sync::{OwnedSemaphorePermit, Semaphore};

fn decode_concurrency() -> usize {
    match std::env::var("WHISPER_DECODE_CONCURRENCY") {
        Ok(s) => s.trim().parse::<usize>().unwrap_or(2).max(1),
        Err(_) => 2,
    }
}

fn decode_semaphore() -> Arc<Semaphore> {
    static SEMAPHORE: OnceLock<Arc<Semaphore>> = OnceLock::new();
    Arc::clone(SEMAPHORE.get_or_init(|| {
        let permits = decode_concurrency();
        tracing::info!(permits, "[whisper] 解码并发限制已初始化");
        Arc::new(Semaphore::new(permits))
    }))
}

/// 获取 Whisper 解码许可；默认全进程允许两个解码任务同时运行。
pub async fn acquire_decode_permit() -> anyhow::Result<OwnedSemaphorePermit> {
    decode_semaphore()
        .acquire_owned()
        .await
        .map_err(|e| anyhow::anyhow!("获取 Whisper 解码许可失败: {e}"))
}
