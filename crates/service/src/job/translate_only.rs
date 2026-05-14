//! 仅翻译字幕（单步占位）。

use std::time::Duration;

use taskmill::TaskError;
use tokio::time::sleep;

use super::types::TranslateSubtitleOnlyInput;

/// Taskmill 任务类型名。
pub const TRANSLATE_ONLY_QUEUE: &str = "demo-translate-only";

pub(crate) async fn step_translate_only(job: TranslateSubtitleOnlyInput) -> Result<(), TaskError> {
    tracing::info!(
        subtitle = %job.subtitle_path,
        lang = %job.target_lang,
        "[taskmill-demo] 占位: 仅翻译字幕任务"
    );
    sleep(Duration::from_secs(2)).await;
    Ok(())
}
