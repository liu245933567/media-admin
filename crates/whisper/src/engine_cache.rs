//! 进程内 Whisper 引擎池：相同 [`WhisperEngineConfig`] 复用一组模型实例；空闲超时后释放。

use std::collections::HashMap;
use std::ops::Deref;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::{Duration, Instant};

use anyhow::Result;
use tokio_util::sync::CancellationToken;

use crate::types::WhisperEngineConfig;
use crate::whisper::WhisperEngine;

/// 缓存条目：同配置引擎池 + 最近一次被 acquire 的时间。
struct CacheEntry {
    pool: Arc<WhisperEnginePool>,
    last_used: Instant,
}

/// 一组相同配置的 Whisper 引擎实例。
struct WhisperEnginePool {
    cfg: WhisperEngineConfig,
    max_size: usize,
    state: Mutex<PoolState>,
    available: Condvar,
}

/// Whisper 引擎池内部状态。
struct PoolState {
    idle: Vec<WhisperEngine>,
    total: usize,
}

/// 从池里借出的 Whisper 引擎，drop 时自动归还。
pub struct PooledWhisperEngine {
    pool: Arc<WhisperEnginePool>,
    engine: Option<WhisperEngine>,
}

impl WhisperEnginePool {
    /// 创建指定配置的 Whisper 引擎池。
    fn new(cfg: WhisperEngineConfig, max_size: usize) -> Self {
        Self {
            cfg,
            max_size: max_size.max(1),
            state: Mutex::new(PoolState {
                idle: Vec::new(),
                total: 0,
            }),
            available: Condvar::new(),
        }
    }

    /// 借出一个引擎；池满时等待其它识别任务归还。
    fn acquire(self: &Arc<Self>) -> Result<PooledWhisperEngine> {
        loop {
            let mut state = self
                .state
                .lock()
                .map_err(|e| anyhow::anyhow!("whisper 引擎池 lock: {e}"))?;

            if let Some(engine) = state.idle.pop() {
                tracing::debug!(
                    model = %self.cfg.model_filename,
                    idle = state.idle.len(),
                    total = state.total,
                    max_size = self.max_size,
                    "[whisper] 复用池中空闲模型"
                );
                return Ok(PooledWhisperEngine {
                    pool: Arc::clone(self),
                    engine: Some(engine),
                });
            }

            if state.total < self.max_size {
                state.total += 1;
                let total = state.total;
                drop(state);

                tracing::info!(
                    model = %self.cfg.model_filename,
                    total,
                    max_size = self.max_size,
                    "[whisper] 创建池化模型实例"
                );

                match WhisperEngine::with_config(self.cfg.clone()) {
                    Ok(engine) => {
                        return Ok(PooledWhisperEngine {
                            pool: Arc::clone(self),
                            engine: Some(engine),
                        });
                    }
                    Err(e) => {
                        let mut state = self
                            .state
                            .lock()
                            .map_err(|e| anyhow::anyhow!("whisper 引擎池 lock: {e}"))?;
                        state.total = state.total.saturating_sub(1);
                        self.available.notify_one();
                        return Err(e);
                    }
                }
            }

            tracing::debug!(
                model = %self.cfg.model_filename,
                total = state.total,
                max_size = self.max_size,
                "[whisper] 引擎池已满，等待空闲模型"
            );
            drop(
                self.available
                    .wait(state)
                    .map_err(|e| anyhow::anyhow!("whisper 引擎池 wait: {e}"))?,
            );
        }
    }

    /// 判断池内所有已创建实例是否都处于空闲状态。
    fn is_fully_idle(&self) -> bool {
        let Ok(state) = self.state.lock() else {
            return false;
        };
        state.total == state.idle.len()
    }
}

impl Drop for PooledWhisperEngine {
    fn drop(&mut self) {
        let Some(engine) = self.engine.take() else {
            return;
        };
        let Ok(mut state) = self.pool.state.lock() else {
            tracing::warn!("[whisper] 引擎池 lock 失败，无法归还模型实例");
            return;
        };
        state.idle.push(engine);
        self.pool.available.notify_one();
    }
}

impl Deref for PooledWhisperEngine {
    type Target = WhisperEngine;

    fn deref(&self) -> &Self::Target {
        self.engine
            .as_ref()
            .expect("PooledWhisperEngine must contain an engine before drop")
    }
}

fn engine_cache() -> &'static Mutex<HashMap<WhisperEngineConfig, CacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<WhisperEngineConfig, CacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 同一模型配置最多保留多少个 Whisper 引擎实例。
///
/// 环境变量：`WHISPER_ENGINE_POOL_SIZE`，默认 1。显存充足时可设置为 2 或 3。
pub fn engine_pool_size() -> usize {
    static POOL_SIZE: OnceLock<AtomicUsize> = OnceLock::new();
    POOL_SIZE
        .get_or_init(|| AtomicUsize::new(read_engine_pool_size_from_env()))
        .load(Ordering::Relaxed)
        .max(1)
}

/// 更新同配置模型池大小；新建模型池会使用该值，已存在模型池需清空缓存后生效。
pub fn set_engine_pool_size(size: usize) {
    static POOL_SIZE: OnceLock<AtomicUsize> = OnceLock::new();
    let size = size.max(1);
    POOL_SIZE
        .get_or_init(|| AtomicUsize::new(read_engine_pool_size_from_env()))
        .store(size, Ordering::Relaxed);
    tracing::info!(pool_size = size, "[whisper] 引擎池大小已更新");
}

fn read_engine_pool_size_from_env() -> usize {
    match std::env::var("WHISPER_ENGINE_POOL_SIZE") {
        Ok(s) => s.trim().parse::<usize>().unwrap_or(1).max(1),
        Err(_) => 1,
    }
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
        pool_size = engine_pool_size(),
        "[whisper] 引擎池空闲回收已启动"
    );

    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tick);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::debug!("[whisper] 引擎池空闲回收已停止");
                    break;
                }
                _ = interval.tick() => {
                    let n = evict_idle_engines();
                    if n > 0 {
                        tracing::debug!(removed = n, "[whisper] 后台回收缓存模型池");
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
            if !entry.pool.is_fully_idle() {
                tracing::debug!(
                    model = %cfg.model_filename,
                    idle_secs = idle.as_secs(),
                    ttl_secs = ttl.as_secs(),
                    "[whisper] 模型池仍有借出实例，跳过空闲回收"
                );
                return true;
            }
            tracing::info!(
                model = %cfg.model_filename,
                idle_secs = idle.as_secs(),
                ttl_secs = ttl.as_secs(),
                "[whisper] 空闲超时，释放缓存模型池"
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
) -> Arc<WhisperEnginePool> {
    if let Some(entry) = cache.get_mut(&cfg) {
        entry.last_used = Instant::now();
        tracing::debug!(
            model = %cfg.model_filename,
            use_gpu = cfg.use_gpu,
            flash_attn = cfg.flash_attn,
            pool_size = entry.pool.max_size,
            "[whisper] 复用缓存模型池"
        );
        return Arc::clone(&entry.pool);
    }

    let pool = Arc::new(WhisperEnginePool::new(cfg.clone(), engine_pool_size()));
    cache.insert(
        cfg.clone(),
        CacheEntry {
            pool: Arc::clone(&pool),
            last_used: Instant::now(),
        },
    );
    tracing::info!(
        model = %cfg.model_filename,
        cached = cache.len(),
        pool_size = pool.max_size,
        idle_secs = engine_cache_idle_ttl().as_secs(),
        "[whisper] 模型池已写入进程缓存"
    );
    pool
}

/// 将任务可选配置解析为实际引擎配置。
pub fn resolve_engine_config(
    whisper_engine_config: Option<WhisperEngineConfig>,
) -> WhisperEngineConfig {
    whisper_engine_config.unwrap_or_default()
}

/// 获取池化引擎（同配置最多保留 `WHISPER_ENGINE_POOL_SIZE` 个模型实例）。
///
/// 返回的句柄在 drop 时自动归还模型实例；调用方无需额外加锁。
pub fn acquire_pooled_engine(
    whisper_engine_config: Option<WhisperEngineConfig>,
) -> Result<PooledWhisperEngine> {
    let cfg = resolve_engine_config(whisper_engine_config);
    let pool = {
        let mut cache = engine_cache()
            .lock()
            .map_err(|e| anyhow::anyhow!("whisper 引擎缓存 lock: {e}"))?;

        evict_idle_locked(&mut cache);
        touch_or_insert(&mut cache, cfg)
    };

    pool.acquire()
}
