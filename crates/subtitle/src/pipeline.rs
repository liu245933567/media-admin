//! 高效视频字幕流水线：管道 PCM → Whisper 识别 → 清洗 → 写源 SRT；翻译由调用方独立入队。

use std::{
    path::Path,
    sync::{Arc, Mutex},
};

use anyhow::{Context, Result};
use ma_whisper::{
    decode_gate::acquire_decode_permit,
    generate::{recognize_pcm_i16, recognize_pcm_i16_chunk_stream},
    types::WhisperTranscribeItem,
    wav::{extract_pcm_i16_mono16k, stream_pcm_i16_mono16k_chunks},
};
use tokio::{sync::mpsc, task::spawn_blocking};

use crate::{
    file::write_srt_file,
    generate::{SubtitleGenerateOutcome, pending_translate_from, should_chain_translate},
    segment_filter::{merge_interval_into_sanitized, sanitize_whisper_segments},
    translate::{default_translated_path, overlap_translate_whisper_segments},
    types::{SubtitleGenerateConfig, SubtitleGenerateItem},
    utils::same_language,
};

/// 统一流水线：识别 → 清洗 → 写源 SRT；翻译通过 [`SubtitleGenerateOutcome::pending_translate`] 由调度器独立入队。
pub async fn generate_subtitle_pipeline(
    video_path: &Path,
    config: &SubtitleGenerateConfig,
) -> Result<SubtitleGenerateOutcome> {
    let video_path_str = video_path.display().to_string();
    tracing::info!("[pipeline] 开始: {video_path_str}");

    let samples = extract_pcm_i16_mono16k(video_path)
        .await
        .with_context(|| format!("提取 PCM 失败: {video_path_str}"))?;
    tracing::info!(
        "[pipeline] 已加载 PCM: {} 样本 (~{:.1}s)",
        samples.len(),
        samples.len() as f64 / 16_000.0
    );

    let vad_config = config.vad_config.clone();
    let whisper_engine_config = config.whisper_engine_config.clone();
    let whisper_transcribe_config = config.whisper_transcribe_config.clone();

    tracing::info!("[pipeline] 等待 Whisper 解码许可");
    let decode_permit = acquire_decode_permit()
        .await
        .context("获取 Whisper 解码许可失败")?;
    tracing::info!("[pipeline] 已获取 Whisper 解码许可，开始识别");

    let recognize_output = spawn_blocking(move || {
        let _decode_permit = decode_permit;
        recognize_pcm_i16(
            &samples,
            vad_config,
            whisper_engine_config,
            whisper_transcribe_config,
        )
    })
    .await
    .context("Whisper 任务 join 失败")?
    .context("Whisper 识别失败")?;

    let detected_lang = recognize_output.lang;
    let raw_count = recognize_output.items.len();
    let source = sanitize_whisper_segments(recognize_output.items);

    tracing::info!(
        "[pipeline] 识别完成: 原始 {raw_count} 条 → 清洗后 {} 条, 语种 {:?}",
        source.len(),
        detected_lang
    );

    let source_srt_path = write_srt_file(video_path, None, &source, detected_lang.clone()).await?;

    let pending_translate = pending_translate_from(
        &source_srt_path,
        detected_lang.as_deref(),
        &source,
        config.translate_config.as_ref(),
    );

    tracing::info!("[pipeline] 源 SRT: {}", source_srt_path.display());

    Ok(SubtitleGenerateOutcome {
        items: vec![SubtitleGenerateItem {
            srt_path: source_srt_path.display().to_string(),
            translated_srt_path: None,
        }],
        pending_translate,
    })
}

struct PcmChunkIter {
    rx: mpsc::Receiver<Result<Vec<i16>>>,
}

impl Iterator for PcmChunkIter {
    type Item = Result<Vec<i16>>;

    fn next(&mut self) -> Option<Self::Item> {
        self.rx.blocking_recv()
    }
}

fn sync_translated_timeline(
    translated: &mut Vec<WhisperTranscribeItem>,
    source: &[WhisperTranscribeItem],
) {
    for (i, src) in source.iter().enumerate() {
        if let Some(dst) = translated.get_mut(i) {
            dst.start_cs = src.start_cs;
            dst.end_cs = src.end_cs;
        } else {
            translated.push(src.clone());
        }
    }
}

fn overlap_translate_config(
    config: &SubtitleGenerateConfig,
) -> Option<crate::types::SubtitleTranslateConfig> {
    let tc = config.translate_config.clone()?;
    if let Some(src) = config
        .whisper_transcribe_config
        .as_ref()
        .and_then(|c| c.language.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty() && *s != "auto")
    {
        if same_language(src, &tc.target_language) {
            tracing::info!(
                "[pipeline:overlap] 配置源语种 {src} 与目标语种 {} 一致，跳过重叠翻译",
                tc.target_language
            );
            return None;
        }
    }
    Some(tc)
}

/// 重叠流水线：读取视频 PCM 时同步做 ffmpeg 降噪/VAD/Whisper，并把已识别条目并行提交翻译。
///
/// 该入口会在流水线内直接写出源 SRT 和译文 SRT，不再返回待入队翻译任务。
pub async fn generate_subtitle_pipeline_overlap(
    video_path: &Path,
    config: &SubtitleGenerateConfig,
) -> Result<SubtitleGenerateOutcome> {
    let video_path_buf = video_path.to_path_buf();
    let video_path_str = video_path.display().to_string();
    tracing::info!("[pipeline:overlap] 开始: {video_path_str}");

    let source_segments = Arc::new(Mutex::new(Vec::<WhisperTranscribeItem>::new()));
    let translated_segments = Arc::new(Mutex::new(Vec::<WhisperTranscribeItem>::new()));

    let translate_config = overlap_translate_config(config);
    let (notify_tx, notify_rx) = tokio::sync::mpsc::unbounded_channel();
    let translate_handle = translate_config.clone().map(|tc| {
        let segments = Arc::clone(&translated_segments);
        tokio::spawn(
            async move { overlap_translate_whisper_segments(segments, notify_rx, tc).await },
        )
    });

    let (pcm_tx, pcm_rx) = mpsc::channel::<Result<Vec<i16>>>(8);
    let read_path = video_path_buf.clone();
    let read_handle =
        tokio::spawn(async move { stream_pcm_i16_mono16k_chunks(&read_path, pcm_tx).await });

    let vad_config = config.vad_config.clone();
    let whisper_engine_config = config.whisper_engine_config.clone();
    let whisper_transcribe_config = config.whisper_transcribe_config.clone();
    let source_for_decode = Arc::clone(&source_segments);
    let translated_for_decode = Arc::clone(&translated_segments);
    let notify_for_decode = notify_tx.clone();

    tracing::info!("[pipeline:overlap] 等待 Whisper 解码许可");
    let decode_permit = acquire_decode_permit()
        .await
        .context("获取 Whisper 解码许可失败")?;

    let recognize_output = spawn_blocking(move || {
        let _decode_permit = decode_permit;
        let chunks = PcmChunkIter { rx: pcm_rx };
        recognize_pcm_i16_chunk_stream(
            chunks,
            vad_config,
            whisper_engine_config,
            whisper_transcribe_config,
            |interval_items, idx, _| {
                let snapshot = {
                    let mut source = source_for_decode.lock().expect("source segments lock");
                    let before = source.len();
                    merge_interval_into_sanitized(&mut source, interval_items.to_vec());
                    if source.len() > before {
                        tracing::info!(
                            "[pipeline:overlap] 区间 #{idx} 识别新增 {} 条，累计 {} 条",
                            source.len() - before,
                            source.len()
                        );
                    }
                    source.clone()
                };

                {
                    let mut translated = translated_for_decode
                        .lock()
                        .expect("translated segments lock");
                    sync_translated_timeline(&mut translated, &snapshot);
                }

                let _ = notify_for_decode.send(());
                Ok(())
            },
        )
    })
    .await
    .context("Whisper 流式任务 join 失败")?
    .context("Whisper 流式识别失败");

    drop(notify_tx);

    let read_res = read_handle.await.context("ffmpeg 流式读取任务 join 失败")?;
    if recognize_output.is_ok() {
        read_res.context("ffmpeg 流式读取失败")?;
    }
    let recognize_output = recognize_output?;

    if let Some(handle) = translate_handle {
        handle
            .await
            .context("重叠翻译任务 join 失败")?
            .context("重叠翻译失败")?;
    }

    let detected_lang = recognize_output.lang;
    let source = {
        let source = source_segments.lock().expect("source segments lock");
        source.clone()
    };
    let source = if source.is_empty() {
        sanitize_whisper_segments(recognize_output.items)
    } else {
        source
    };

    tracing::info!(
        "[pipeline:overlap] 识别完成: {} 条, 语种 {:?}",
        source.len(),
        detected_lang
    );

    let source_srt_path = write_srt_file(video_path, None, &source, detected_lang.clone()).await?;
    let mut translated_srt_path = None;

    if let Some(tc) = translate_config {
        let translated = {
            let translated = translated_segments
                .lock()
                .expect("translated segments lock");
            translated.clone()
        };
        if !translated.is_empty() {
            let dst = default_translated_path(&source_srt_path, &tc.target_language);
            write_srt_file(video_path, Some(dst.clone()), &translated, None).await?;
            if tc.remove_source_srt {
                tokio::fs::remove_file(&source_srt_path)
                    .await
                    .with_context(|| format!("删除源 SRT 失败: {}", source_srt_path.display()))?;
            }
            translated_srt_path = Some(dst.display().to_string());
        }
    }

    let pending_translate = if translated_srt_path.is_some() {
        None
    } else {
        should_chain_translate(
            detected_lang.as_deref(),
            &source,
            config.translate_config.as_ref(),
        )
        .map(|config| crate::generate::PendingTranslateEnqueue {
            source_srt_path: source_srt_path.display().to_string(),
            config,
        })
    };

    Ok(SubtitleGenerateOutcome {
        items: vec![SubtitleGenerateItem {
            srt_path: source_srt_path.display().to_string(),
            translated_srt_path,
        }],
        pending_translate,
    })
}
