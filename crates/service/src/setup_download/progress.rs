//! 设置页下载进度：对接 Taskmill `ProgressReporter`。

use taskmill::ProgressReporter;

/// 单次下载任务的进度句柄。
pub struct DownloadProgressHandle<'a> {
    reporter: &'a ProgressReporter,
}

impl<'a> DownloadProgressHandle<'a> {
    pub fn new(reporter: &'a ProgressReporter) -> Self {
        Self { reporter }
    }

    /// 更新阶段与字节进度，并写入 Taskmill。
    pub async fn update(
        &self,
        phase: &str,
        received: u64,
        total: Option<u64>,
        message: impl Into<String>,
    ) {
        let message = message.into();
        let pct = percent_for_phase(phase, received, total);
        if let Some(t) = total.filter(|t| *t > 0) {
            self.reporter.report_bytes(received, t);
        }
        self.reporter.report(pct, Some(message));
    }
}

fn percent_for_phase(phase: &str, received: u64, total: Option<u64>) -> f32 {
    match phase {
        "pending" => 0.0,
        "resolving" => 0.02,
        "downloading" => {
            let Some(t) = total.filter(|t| *t > 0) else {
                return 0.1;
            };
            0.05 + 0.75 * (received as f32 / t as f32)
        }
        "extracting" => 0.82,
        "moving" => 0.92,
        "done" => 1.0,
        "error" => 0.0,
        _ => 0.05,
    }
}
