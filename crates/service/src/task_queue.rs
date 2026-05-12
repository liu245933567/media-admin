use std::sync::{
    Arc,
    atomic::{AtomicU8, Ordering},
};

use tokio::sync::Notify;

const QUEUE_STATE_RUNNING: u8 = 0;
const QUEUE_STATE_PAUSING: u8 = 1;
const QUEUE_STATE_PAUSED: u8 = 2;

/// 内存中的任务队列运行状态（与 DB 任务状态无关）。
#[derive(Clone)]
pub struct BackgroundTaskQueue {
    notify: Arc<Notify>,
    state: Arc<AtomicU8>,
}

impl BackgroundTaskQueue {
    pub fn new() -> Self {
        Self {
            notify: Arc::new(Notify::new()),
            state: Arc::new(AtomicU8::new(QUEUE_STATE_RUNNING)),
        }
    }

    pub fn enqueue(&self) {
        self.notify.notify_one();
    }

    /// 请求暂停：不再 claim 新任务；当前正在执行的任务结束后进入 PAUSED。
    pub fn request_pause(&self) {
        self.state.store(QUEUE_STATE_PAUSING, Ordering::Relaxed);
    }

    pub fn resume(&self) {
        self.state.store(QUEUE_STATE_RUNNING, Ordering::Relaxed);
        self.notify.notify_one();
    }

    pub fn is_pausing(&self) -> bool {
        self.state.load(Ordering::Relaxed) == QUEUE_STATE_PAUSING
    }

    pub fn is_paused(&self) -> bool {
        self.state.load(Ordering::Relaxed) == QUEUE_STATE_PAUSED
    }

    pub fn status(&self) -> &'static str {
        match self.state.load(Ordering::Relaxed) {
            QUEUE_STATE_RUNNING => "RUNNING",
            QUEUE_STATE_PAUSING => "PAUSING",
            QUEUE_STATE_PAUSED => "PAUSED",
            _ => "UNKNOWN",
        }
    }

    /// 长任务结束后或空闲 tick：若处于 PAUSING 则进入 PAUSED。
    pub fn mark_paused_if_pausing(&self) {
        if self.is_pausing() {
            self.state.store(QUEUE_STATE_PAUSED, Ordering::Relaxed);
        }
    }

    pub fn notified(&self) -> impl std::future::Future<Output = ()> + Send + '_ {
        self.notify.notified()
    }
}
