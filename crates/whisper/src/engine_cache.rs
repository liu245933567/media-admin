//! 进程内 Whisper 引擎缓存：相同 [`WhisperEngineConfig`] 只加载一次；空闲超时后释放。

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use anyhow::Result;
use tokio_util::sync::CancellationToken;

use crate::types::WhisperEngineConfig;
use crate::whisper::WhisperEngine;

/// 缓存条目：引擎实例 + 最近一次被 `acquire` 的时间。
struct CacheEntry {
    engine: Arc<Mutex<WhisperEngine>>,
    last_used: Instant,
}

fn engine_cache() -> &'static Mutex<HashMap<WhisperEngineConfig, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<WhisperEngineConfig, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 空闲多久后卸载模型；`0` 表示不自动释放（仅进程退出时释放）。
///
/// 环境变量：`WHISPER_ENGINE_CACHE_IDLE_SECS`，默认 600（10 分钟）。
pub fn engine_cache_idle_ttl() -> Duration {
    match std::env::var("WHISPER_ENGINE_CACHE_IDLE_SECS") {
        Ok(s) => {
            let secs: u64 = s.trim().parse().unwrap_or(600);
            if secs == 0 {
                Duration::MAX
            } else {
                Duration::from_secs(secs)
            }
        }
        Err(_) => Duration::from_secs(600),
    }
}

fn eviction_enabled() -> bool {
    engine_cache_idle_ttl() != Duration::MAX
}

/// 后台巡检间隔（约为 TTL 的 1/5，30s～300s）。
fn eviction_tick_interval() -> Duration {
    let ttl = engine_cache_idle_ttl();
    if ttl == Duration::MAX {
        return Duration::from_secs(300);
    }
    (ttl / 5).clamp(Duration::from_secs(30), Duration::from_secs(300))
}

/// 移除超过空闲 TTL 的缓存项；`WhisperEngine` drop 时释放 GPU/内存。
pub fn evict_idle_engines() -> usize {
    if !eviction_enabled() {
        return 0;
    }
    let mut cache = match engine_cache().lock() {
        Ok(g) => g,
        Err(e) => {
            tracing::warn!("[whisper] 引擎缓存 lock 失败，跳过空闲回收: {e}");
            return 0;
        }
    };
    evict_idle_locked(&mut cache)
}

/// 清空全部缓存（调试或切换模型策略时使用）。
pub fn clear_engine_cache() -> usize {
    let mut cache = match engine_cache().lock() {
        Ok(g) => g,
        Err(e) => {
            tracing::warn!("[whisper] 引擎缓存 lock 失败，无法清空: {e}");
            return 0;
        }
    };
    let n = cache.len();
    cache.clear();
    if n > 0 {
        tracing::info!(removed = n, "[whisper] 已清空引擎缓存");
    }
    n
}

/// 启动后台空闲回收（与调度器同生命周期；重复调用无效）。
pub fn spawn_idle_eviction_loop(cancel: CancellationToken) {
    if !eviction_enabled() {
        tracing::info!("[whisper] WHISPER_ENGINE_CACHE_IDLE_SECS=0，跳过引擎空闲回收");
        return;
    }

    static STARTED: OnceLock<()> = OnceLock::new();
    if STARTED.get().is_some() {
        return;
    }
    let _ = STARTED.set(());

    let tick = eviction_tick_interval();
    let ttl = engine_cache_idle_ttl();
    tracing::info!(
        idle_secs = ttl.as_secs(),
        tick_secs = tick.as_secs(),
        "[whisper] 引擎缓存空闲回收已启动"
    );

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tick);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::debug!("[whisper] 引擎缓存空闲回收已停止");
                    break;
                }
                _ = interval.tick() => {
                    let n = evict_idle_engines();
                    if n > 0 {
                        tracing::debug!(removed = n, "[whisper] 后台回收缓存模型");
                    }
                }
            }
        }
    });
}

fn evict_idle_locked(cache: &mut HashMap<WhisperEngineConfig, CacheEntry>) -> usize {
    if !eviction_enabled() {
        return 0;
    }
    let ttl = engine_cache_idle_ttl();
    let now = Instant::now();
    let before = cache.len();
    cache.retain(|cfg, entry| {
        let idle = now.duration_since(entry.last_used);
        if idle >= ttl {
            tracing::info!(
                model = %cfg.model_filename,
                idle_secs = idle.as_secs(),
                ttl_secs = ttl.as_secs(),
                "[whisper] 空闲超时，释放缓存模型"
            );
            false
        } else {
            true
        }
    });
    before.saturating_sub(cache.len())
}

fn touch_or_insert(
    cache: &mut HashMap<WhisperEngineConfig, CacheEntry>,
    cfg: WhisperEngineConfig,
) -> Result<Arc<Mutex<WhisperEngine>>> {
    if let Some(entry) = cache.get_mut(&cfg) {
        entry.last_used = Instant::now();
        tracing::debug!(
            model = %cfg.model_filename,
            use_gpu = cfg.use_gpu,
            flash_attn = cfg.flash_attn,
            "[whisper] 复用缓存模型"
        );
        return Ok(Arc::clone(&entry.engine));
    }

    let engine = Arc::new(Mutex::new(WhisperEngine::with_config(cfg.clone())?));
    cache.insert(
        cfg.clone(),
        CacheEntry {
            engine: Arc::clone(&engine),
            last_used: Instant::now(),
        },
    );
    tracing::info!(
        model = %cfg.model_filename,
        cached = cache.len(),
        idle_secs = engine_cache_idle_ttl().as_secs(),
        "[whisper] 模型已加载并写入进程缓存"
    );
    Ok(engine)
}

/// 将任务可选配置解析为实际引擎配置。
pub fn resolve_engine_config(
    whisper_engine_config: Option<WhisperEngineConfig>,
) -> WhisperEngineConfig {
    whisper_engine_config.unwrap_or_default()
}

/// 获取共享引擎（同配置复用已加载的 `WhisperContext`）。
///
/// 返回的 `Arc<Mutex<WhisperEngine>>` 应在单次识别流程内持有锁，避免并发转写。
pub fn acquire_shared_engine(
    whisper_engine_config: Option<WhisperEngineConfig>,
) -> Result<Arc<Mutex<WhisperEngine>>> {
    let cfg = resolve_engine_config(whisper_engine_config);
    let mut cache = engine_cache()
        .lock()
        .map_err(|e| anyhow::anyhow!("whisper 引擎缓存 lock: {e}"))?;

    evict_idle_locked(&mut cache);
    touch_or_insert(&mut cache, cfg)
}
