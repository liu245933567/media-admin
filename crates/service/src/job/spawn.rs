//! Taskmill 调度器启动与任务 executor。

use std::path::Path;

use ma_subtitle::generate::{pending_translate_from, write_srt_from_recognize};
use ma_subtitle::segment_filter::sanitize_whisper_segments;
use ma_subtitle::translate::translate_srt_file;
use ma_whisper::decode_gate::acquire_decode_permit;
use ma_whisper::engine_cache::spawn_idle_eviction_loop;
use ma_whisper::generate::recognize_wav_voice_incremental;
use ma_whisper::wav::extract_wav_i16_mono16k;
use taskmill::{DomainTaskContext, TaskError, TypedExecutor};
use tokio::{sync::mpsc, task::spawn_blocking};

use super::storage::{MediaLibraryScanDeps, TaskmillRuntime};
use super::types::{
    MediaJobsDomain, MediaLibraryScanTask, SubtitleTranslateJob, VideoSubtitleExtractWavTask,
    VideoSubtitleGenerateTask, VideoSubtitleRecognizeTask,
};

pub struct VideoSubtitleGenerateExecutor;

impl TypedExecutor<VideoSubtitleGenerateTask> for VideoSubtitleGenerateExecutor {
    async fn execute(
        &self,
        job: VideoSubtitleGenerateTask,
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        let video_path = job.video_path.trim();
        if video_path.is_empty() {
            return Err(TaskError::permanent("video_path 不能为空"));
        }

        ctx.progress()
            .report(0.05, Some(format!("开始字幕流水线编排: {video_path}")));
        ctx.check_cancelled()?;

        ctx.spawn_child_with(VideoSubtitleExtractWavTask {
            video_path: video_path.to_string(),
            config: job.config,
        })
        .await
        .map_err(|e| TaskError::retryable(format!("入队音频提取子任务失败: {e:#}")))?;

        ctx.progress()
            .report(0.2, Some("已入队音频提取子任务".into()));
        Ok(())
    }

    async fn finalize(
        &self,
        job: VideoSubtitleGenerateTask,
        _memo: (),
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        ctx.progress()
            .report(1.0, Some(format!("字幕流水线全部完成: {}", job.video_path)));
        Ok(())
    }
}

pub struct VideoSubtitleExtractWavExecutor;

impl TypedExecutor<VideoSubtitleExtractWavTask> for VideoSubtitleExtractWavExecutor {
    async fn execute(
        &self,
        job: VideoSubtitleExtractWavTask,
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        let video_path = job.video_path.trim();
        if video_path.is_empty() {
            return Err(TaskError::permanent("video_path 不能为空"));
        }

        ctx.progress()
            .report(0.05, Some(format!("开始提取 WAV: {video_path}")));
        ctx.check_cancelled()?;

        let wav_path = extract_wav_i16_mono16k(Path::new(video_path), None)
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;

        ctx.progress()
            .report(0.9, Some(format!("WAV 缓存完成: {}", wav_path.display())));
        if let Err(e) = ctx.check_cancelled() {
            remove_wav_cache_best_effort(wav_path.to_string_lossy().as_ref()).await;
            return Err(e);
        }

        if let Err(e) = ctx.spawn_sibling_with(VideoSubtitleRecognizeTask {
            video_path: video_path.to_string(),
            wav_path: wav_path.to_string_lossy().into_owned(),
            config: job.config,
        })
        .await
        {
            remove_wav_cache_best_effort(wav_path.to_string_lossy().as_ref()).await;
            return Err(TaskError::retryable(format!("入队识别子任务失败: {e:#}")));
        }

        ctx.progress().report(1.0, Some("已入队识别子任务".into()));
        Ok(())
    }
}

pub struct VideoSubtitleRecognizeExecutor;

struct RecognizeProgressEvent {
    percent: f32,
    message: String,
}

fn format_whisper_time_cs(cs: i64) -> String {
    let safe = cs.max(0);
    let total_seconds = safe / 100;
    let centiseconds = safe % 100;
    let hours = total_seconds / 3600;
    let minutes = (total_seconds % 3600) / 60;
    let seconds = total_seconds % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}.{centiseconds:02}")
}

fn truncate_log_text(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    let mut chars = trimmed.chars();
    let head: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{head}...")
    } else {
        head
    }
}

fn format_recognized_items_log(items: &[ma_whisper::types::WhisperTranscribeItem]) -> String {
    const MAX_TEXT_CHARS: usize = 160;

    items
        .iter()
        .filter_map(|item| {
            let text = truncate_log_text(&item.text, MAX_TEXT_CHARS);
            if text.is_empty() {
                return None;
            }
            Some(format!(
                "[{} - {}] {text}",
                format_whisper_time_cs(item.start_cs),
                format_whisper_time_cs(item.end_cs),
            ))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

async fn remove_wav_cache_best_effort(wav_path: &str) {
    if wav_path.trim().is_empty() {
        return;
    }
    if let Err(e) = tokio::fs::remove_file(wav_path).await {
        tracing::warn!(wav = wav_path, error = %e, "删除 WAV 缓存失败");
    }
}

impl TypedExecutor<VideoSubtitleRecognizeTask> for VideoSubtitleRecognizeExecutor {
    async fn execute(
        &self,
        job: VideoSubtitleRecognizeTask,
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        let video_path = job.video_path.trim();
        let wav_path = job.wav_path.trim();
        if video_path.is_empty() {
            return Err(TaskError::permanent("video_path 不能为空"));
        }
        if wav_path.is_empty() {
            return Err(TaskError::permanent("wav_path 不能为空"));
        }

        ctx.progress()
            .report(0.05, Some(format!("开始 VAD + Whisper 识别: {wav_path}")));
        ctx.check_cancelled()?;

        let vad_config = job.config.vad_config.clone();
        let whisper_engine_config = job.config.whisper_engine_config.clone();
        let whisper_transcribe_config = job.config.whisper_transcribe_config.clone();
        let wav_path_buf = Path::new(wav_path).to_path_buf();

        let decode_permit = acquire_decode_permit()
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;

        let (progress_tx, mut progress_rx) = mpsc::unbounded_channel::<RecognizeProgressEvent>();
        let mut recognize_handle = spawn_blocking(move || {
            let _decode_permit = decode_permit;
            let mut recognized_items = 0usize;
            recognize_wav_voice_incremental(
                &wav_path_buf,
                vad_config,
                whisper_engine_config,
                whisper_transcribe_config,
                move |items, idx, total| {
                    recognized_items += items.len();
                    let completed = idx.saturating_add(1);
                    let percent = if total > 0 {
                        0.05 + (completed as f32 / total as f32) * 0.8
                    } else {
                        0.85
                    };
                    let summary = if total > 0 {
                        format!(
                            "识别 VAD 片段 {completed}/{total}，新增 {} 条字幕，累计 {recognized_items} 条",
                            items.len()
                        )
                    } else {
                        format!(
                            "识别 VAD 片段 {completed}，新增 {} 条字幕，累计 {recognized_items} 条",
                            items.len()
                        )
                    };
                    let recognized_log = format_recognized_items_log(items);
                    let message = if recognized_log.is_empty() {
                        summary
                    } else {
                        format!("{summary}\n{recognized_log}")
                    };
                    let _ = progress_tx.send(RecognizeProgressEvent { percent, message });
                    Ok(())
                },
            )
        });

        let recognize_res = loop {
            tokio::select! {
                Some(event) = progress_rx.recv() => {
                    ctx.progress().report(event.percent, Some(event.message));
                }
                res = &mut recognize_handle => {
                    break res
                        .map_err(|e| TaskError::retryable(format!("Whisper 任务 join 失败: {e:#}")))?
                        .map_err(|e| TaskError::retryable(format!("{e:#}")));
                }
            }
        };
        while let Ok(event) = progress_rx.try_recv() {
            ctx.progress().report(event.percent, Some(event.message));
        }

        let recognize_output = match recognize_res {
            Ok(out) => out,
            Err(e) => {
                remove_wav_cache_best_effort(wav_path).await;
                return Err(e);
            }
        };

        let detected_lang = recognize_output.lang.clone();
        let source_items = sanitize_whisper_segments(recognize_output.items.clone());
        let outcome = write_srt_from_recognize(video_path, recognize_output, None)
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;

        remove_wav_cache_best_effort(wav_path).await;

        let srt_path = outcome
            .items
            .first()
            .map(|i| i.srt_path.clone())
            .ok_or_else(|| TaskError::retryable("识别未返回 SRT 路径"))?;

        ctx.progress()
            .report(0.9, Some(format!("已生成源字幕: {srt_path}")));
        ctx.check_cancelled()?;

        if let Some(pending) = pending_translate_from(
            Path::new(&srt_path),
            detected_lang.as_deref(),
            &source_items,
            job.config.translate_config.as_ref(),
        ) {
            ctx.spawn_sibling_with(SubtitleTranslateJob {
                source_srt_path: pending.source_srt_path.clone(),
                config: pending.config,
            })
            .await
            .map_err(|e| TaskError::retryable(format!("入队翻译子任务失败: {e:#}")))?;

            ctx.progress().report(
                0.95,
                Some(format!("已入队翻译子任务: {}", pending.source_srt_path)),
            );
        }

        ctx.progress().report(1.0, Some("识别子任务完成".into()));
        Ok(())
    }

    async fn on_cancel(
        &self,
        job: VideoSubtitleRecognizeTask,
        _ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        let wav_path = job.wav_path.trim();
        remove_wav_cache_best_effort(wav_path).await;
        Ok(())
    }
}

pub struct SubtitleTranslateExecutor;

impl TypedExecutor<SubtitleTranslateJob> for SubtitleTranslateExecutor {
    async fn execute(
        &self,
        job: SubtitleTranslateJob,
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        let src = Path::new(job.source_srt_path.trim());
        if job.source_srt_path.trim().is_empty() {
            return Err(TaskError::permanent("source_srt_path 不能为空"));
        }

        ctx.progress().report(
            0.1,
            Some(format!("开始翻译 -> {}", job.config.target_language)),
        );
        ctx.check_cancelled()?;

        let out = translate_srt_file(src, None, &job.config)
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;
        ctx.progress()
            .report(1.0, Some(format!("翻译完成: {}", out.display())));
        Ok(())
    }
}

/// 媒体库扫描任务 executor。
#[derive(Clone)]
pub struct MediaLibraryScanExecutor {
    deps: MediaLibraryScanDeps,
}

impl MediaLibraryScanExecutor {
    /// 创建媒体库扫描 executor。
    pub fn new(deps: MediaLibraryScanDeps) -> Self {
        Self { deps }
    }
}

impl TypedExecutor<MediaLibraryScanTask> for MediaLibraryScanExecutor {
    async fn execute(
        &self,
        job: MediaLibraryScanTask,
        ctx: DomainTaskContext<'_, MediaJobsDomain>,
    ) -> Result<(), TaskError> {
        let root_id = i64::from(job.root_id);
        if root_id <= 0 {
            return Err(TaskError::permanent("root_id 必须大于 0"));
        }
        if job.root_path.trim().is_empty() {
            return Err(TaskError::permanent("root_path 不能为空"));
        }

        ctx.progress()
            .report(0.05, Some(format!("开始扫描媒体资源: {}", job.root_path)));
        ctx.check_cancelled()?;

        let res = crate::media_library::scan_media_root(&self.deps.db, root_id, &job.root_path)
            .await
            .map_err(|e| TaskError::retryable(format!("{e:#}")))?;

        ctx.progress().report(
            1.0,
            Some(format!(
                "扫描完成：{} 个文件（视频 {}，字幕 {}），移除 {} 条旧记录",
                res.scanned, res.videos, res.subtitles, res.removed
            )),
        );
        Ok(())
    }
}

/// 在后台运行 Taskmill scheduler。
pub fn spawn_taskmill_scheduler(runtime: &TaskmillRuntime) {
    let scheduler = runtime.scheduler.clone();
    let cancellation = runtime.cancellation.clone();

    spawn_idle_eviction_loop(cancellation.clone());

    tokio::spawn(async move {
        scheduler.run(cancellation).await;
        tracing::info!("taskmill scheduler stopped");
    });
}
