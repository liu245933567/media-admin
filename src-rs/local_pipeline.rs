use crate::config::Config;
use crate::generation_job::{self, JobDetail, ProgressThrottle};
use crate::whisper_transcribe::{self, WhisperTranscribeParams};
use futures_util::StreamExt;
use hf_hub::Cache;
use hf_hub::Repo;
use serde::{Deserialize, Serialize};
use sha1::Digest;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use uuid::Uuid;

const THROTTLE_MS: u64 = 350;

fn ensure_static_layout(config: &Config) -> anyhow::Result<()> {
    let static_dir = config.static_dir.trim();
    if !static_dir.is_empty() {
        std::fs::create_dir_all(Path::new(static_dir))?;
        std::fs::create_dir_all(Path::new(static_dir).join("models"))?;
        std::fs::create_dir_all(Path::new(static_dir).join("ffmpeg"))?;
    }
    Ok(())
}

fn ggml_file_nonempty(path: &Path) -> bool {
    path.is_file()
        && path
            .metadata()
            .map(|m| m.len() > 4096)
            .unwrap_or(false)
}

fn looks_like_git_lfs_pointer(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    if let Ok(meta) = path.metadata() {
        if meta.len() < 4096 {
            if let Ok(head) = std::fs::read_to_string(path) {
                return head.starts_with("version https://git-lfs.github.com");
            }
        }
    }
    false
}

fn ggml_file_ready(path: &Path) -> bool {
    ggml_file_nonempty(path) && !looks_like_git_lfs_pointer(path)
}

/// `base` 直接指向 `.bin` / `.gguf` 时使用该路径；否则视为目录并在其下（或一级、二级子目录）查找 `hf_filename`。
fn ggml_target_path(base: &Path, hf_filename: &str) -> PathBuf {
    match base.extension().and_then(|e| e.to_str()) {
        Some(ext)
            if ext.eq_ignore_ascii_case("bin") || ext.eq_ignore_ascii_case("gguf") =>
        {
            base.to_path_buf()
        }
        _ => base.join(hf_filename),
    }
}

fn resolve_ggml_model_file(base: &Path, hf_filename: &str) -> Option<PathBuf> {
    let direct = ggml_target_path(base, hf_filename);
    if ggml_file_ready(&direct) {
        return Some(direct);
    }
    if base.is_dir() {
        let cand = base.join(hf_filename);
        if ggml_file_ready(&cand) {
            return Some(cand);
        }
        let rd = std::fs::read_dir(base).ok()?;
        for e in rd.flatten() {
            let p = e.path();
            if !p.is_dir() {
                continue;
            }
            let c = p.join(hf_filename);
            if ggml_file_ready(&c) {
                return Some(c);
            }
            let rd2 = std::fs::read_dir(&p).ok()?;
            for e2 in rd2.flatten() {
                let p2 = e2.path();
                if !p2.is_dir() {
                    continue;
                }
                let c2 = p2.join(hf_filename);
                if ggml_file_ready(&c2) {
                    return Some(c2);
                }
            }
        }
    }
    None
}

#[cfg(windows)]
const DEFAULT_FFMPEG_ZIP: &str =
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

#[derive(Clone)]
pub struct SubSegment {
    pub t0_ms: i64,
    pub t1_ms: i64,
    pub text: String,
}

pub async fn run_local_generation_job(
    pool: SqlitePool,
    config: Arc<Config>,
    job_id: String,
    video: PathBuf,
    model_lock: Arc<Mutex<()>>,
) {
    let video_str = video.display().to_string();
    tracing::info!(
        job_id = %job_id,
        video = %video_str,
        "本地字幕生成任务开始"
    );
    let mut throttle = ProgressThrottle::new(Duration::from_millis(THROTTLE_MS));
    let mut detail = JobDetail {
        bytes_downloaded: None,
        total_bytes: None,
        current_segment: None,
        total_segments: None,
        video_path: Some(video_str.clone()),
        subtitle_path: None,
        whisper_logs: None,
    };

    match run_inner(
        &pool,
        &config,
        &job_id,
        &video,
        &mut throttle,
        &mut detail,
        model_lock,
    )
    .await
    {
        Ok(()) => {
            tracing::info!(
                job_id = %job_id,
                video = %video_str,
                subtitle = ?detail.subtitle_path,
                "本地字幕生成任务成功"
            );
        }
        Err(e) => {
            let chain = format!("{e:#}");
            tracing::error!(
                job_id = %job_id,
                video = %video_str,
                error = %chain,
                "本地字幕生成任务失败"
            );
            if let Err(db_err) = generation_job::fail_job(&pool, &job_id, "error", &chain).await {
                tracing::error!(
                    job_id = %job_id,
                    error = %format!("{db_err:#}"),
                    "写入任务失败状态时出错"
                );
            }
        }
    }
}

async fn run_inner(
    pool: &SqlitePool,
    config: &Config,
    job_id: &str,
    video: &PathBuf,
    throttle: &mut ProgressThrottle,
    detail: &mut JobDetail,
    model_lock: Arc<Mutex<()>>,
) -> anyhow::Result<()> {
    // Keep workspace layout stable for new clones.
    // `static/models` stores downloaded whisper ggml files; `static/ffmpeg` stores optional ffmpeg distro.
    ensure_static_layout(config)?;

    // --- Model（whisper.cpp GGML，经 whisper-rs 加载） ---
    throttle
        .maybe_update(
            pool,
            job_id,
            "ensure_model",
            5.0,
            "检查 whisper GGML 模型",
            Some(detail),
            true,
        )
        .await?;

    let user_model_base = PathBuf::from(config.whisper_model_path.trim());
    let hf_filename = config.whisper_ggml_filename.trim();
    let resolved_local = resolve_ggml_model_file(&user_model_base, hf_filename);

    let model_file = if let Some(path) = resolved_local {
        tracing::info!(
            configured = %user_model_base.display(),
            resolved = %path.display(),
            "使用本地 GGML 模型文件"
        );
        throttle
            .maybe_update(
                pool,
                job_id,
                "ensure_model",
                20.0,
                "使用本地模型文件",
                Some(detail),
                true,
            )
            .await?;
        path.canonicalize().unwrap_or(path)
    } else {
        let _guard = model_lock.lock().await;
        let retry_base = PathBuf::from(config.whisper_model_path.trim());
        if let Some(path) = resolve_ggml_model_file(&retry_base, hf_filename) {
            tracing::info!(
                configured = %retry_base.display(),
                resolved = %path.display(),
                "使用本地 GGML 模型文件（获取锁后解析）"
            );
            throttle
                .maybe_update(
                    pool,
                    job_id,
                    "ensure_model",
                    20.0,
                    "使用本地模型文件",
                    Some(detail),
                    true,
                )
                .await?;
            path.canonicalize().unwrap_or(path)
        } else {
            let dest = ggml_target_path(&retry_base, hf_filename);
            download_ggml_model_from_hf(pool, config, job_id, throttle, detail, &dest).await?;
            dest.canonicalize().unwrap_or(dest)
        }
    };

    let model_file_str = model_file.display().to_string();

    // --- FFmpeg ---
    throttle
        .maybe_update(
            pool,
            job_id,
            "ensure_ffmpeg",
            21.0,
            "检查 ffmpeg",
            Some(detail),
            true,
        )
        .await?;

    let ffmpeg_exe = ensure_ffmpeg_bin(pool, config, job_id, throttle, detail).await?;

    // --- Audio ---
    throttle
        .maybe_update(
            pool,
            job_id,
            "extract_audio",
            26.0,
            "使用 ffmpeg 抽取音频",
            Some(detail),
            true,
        )
        .await?;

    let audio_tmp = std::env::temp_dir().join(format!("sa_audio_{job_id}.wav"));
    extract_audio_ffmpeg(config, &ffmpeg_exe, video, &audio_tmp).await?;

    throttle
        .maybe_update(
            pool,
            job_id,
            "extract_audio",
            30.0,
            "音频抽取完成",
            Some(detail),
            true,
        )
        .await?;

    let wav_str = audio_tmp.display().to_string();

    // --- Transcribe（逐段日志写入 detail，供前端轮询） ---
    detail.whisper_logs = Some(Vec::new());
    throttle
        .maybe_update(
            pool,
            job_id,
            "transcribe",
            34.0,
            "Whisper（whisper-rs）转写中（见下方实时日志）",
            Some(detail),
            true,
        )
        .await?;

    let device = config.whisper_device.clone();
    let compute = config.whisper_compute_type.clone();
    let model_for_task = model_file_str.clone();
    let wav_for_task = wav_str.clone();
    let whisper_cfg = WhisperTranscribeParams {
        vad_enable: config.whisper_vad_enable,
        vad_mode: config.whisper_vad_mode,
        vad_frame_ms: config.whisper_vad_frame_ms,
        vad_padding_ms: config.whisper_vad_padding_ms,
        vad_min_speech_ms: config.whisper_vad_min_speech_ms,
        ..WhisperTranscribeParams::default()
    };

    let shared_logs: std::sync::Arc<std::sync::Mutex<Vec<String>>> =
        std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let shared_logs_worker = shared_logs.clone();

    let mut transcribe_jh = tokio::task::spawn_blocking(move || {
        whisper_transcribe::transcribe_wav_with_logs(
            model_for_task,
            wav_for_task,
            device,
            compute,
            whisper_cfg,
            shared_logs_worker,
        )
    });

    let mut interval = tokio::time::interval(Duration::from_millis(400));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    let segments = loop {
        tokio::select! {
            res = &mut transcribe_jh => {
                let timed = res.map_err(|e| anyhow::anyhow!("转写线程异常: {e}"))??;
                let segs: Vec<SubSegment> = timed
                    .into_iter()
                    .filter(|t| !t.text.is_empty())
                    .map(|t| SubSegment {
                        t0_ms: t.t0_ms,
                        t1_ms: t.t1_ms,
                        text: t.text,
                    })
                    .collect();
                let snap = shared_logs.lock().unwrap().clone();
                detail.whisper_logs = Some(snap);
                break segs;
            }
            _ = interval.tick() => {
                let snap = shared_logs.lock().unwrap().clone();
                if snap.is_empty() {
                    continue;
                }
                detail.whisper_logs = Some(snap.clone());
                let n = snap.len();
                let prog = 34.0_f64 + (n as f64 * 0.04).min(22.0);
                throttle
                    .maybe_update(
                        pool,
                        job_id,
                        "transcribe",
                        prog,
                        &format!("Whisper 转写中（{n} 条日志）"),
                        Some(detail),
                        false,
                    )
                    .await?;
            }
        }
    };

    let _ = tokio::fs::remove_file(&audio_tmp).await;

    if segments.is_empty() {
        let snap = shared_logs.lock().unwrap().clone();
        let tail = snap
            .into_iter()
            .rev()
            .take(40)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join("\n");
        anyhow::bail!(
            "未识别到语音内容（Whisper 输出为空）。常见原因：视频无音轨/抽取音频失败/音量接近静音/选错音轨。\n\n最近 Whisper 日志：\n{}",
            tail
        );
    }

    detail.total_segments = Some(segments.len() as u32);
    throttle
        .maybe_update(
            pool,
            job_id,
            "transcribe",
            58.0,
            &format!("转写完成，共 {} 段", segments.len()),
            Some(detail),
            true,
        )
        .await?;

    // --- Translate ---
    if config.deepseek_api_key.trim().is_empty() {
        anyhow::bail!("未设置 DEEPSEEK_API_KEY，无法翻译");
    }

    let translated = translate_all_segments(
        pool,
        config,
        job_id,
        throttle,
        detail,
        segments,
    )
    .await?;

    // --- Write SRT ---
    throttle
        .maybe_update(
            pool,
            job_id,
            "write_file",
            96.0,
            "写入字幕文件",
            Some(detail),
            true,
        )
        .await?;

    let stem = video
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| anyhow::anyhow!("无法解析视频主文件名"))?;
    let parent = video
        .parent()
        .ok_or_else(|| anyhow::anyhow!("无法解析视频目录"))?;
    let subtitle_path = parent.join(format!("{stem}.zh.srt"));
    let srt_body = build_srt(&translated);
    tokio::fs::write(&subtitle_path, srt_body.as_bytes()).await?;

    let subtitle_str = subtitle_path.display().to_string();
    detail.subtitle_path = Some(subtitle_str.clone());
    generation_job::set_subtitle_path(pool, job_id, &subtitle_str).await?;

    let video_str = video.display().to_string();
    sqlx::query(
        r#"INSERT INTO subtitle_records (video_path, subtitle_path, source, language, format)
           VALUES (?, ?, 'local_whisper_rs', 'zh', 'srt')"#,
    )
    .bind(&video_str)
    .bind(&subtitle_str)
    .execute(pool)
    .await?;

    generation_job::set_job_succeeded(
        pool,
        job_id,
        &format!("已完成：{}", subtitle_str),
        detail,
    )
    .await?;

    Ok(())
}

/// 预先估算文件大小（用于进度分母）；未知时返回占位值，实际下载中可用 GET 的 Content-Length 覆盖。
/// 依次尝试：官方 metadata → HEAD 的 Content-Length → 占位 1（走未知大小启发式进度）。
async fn hub_file_byte_size(api: &hf_hub::api::tokio::Api, url: &str) -> u64 {
    if let Ok(m) = api.metadata(url).await {
        return m.size() as u64;
    }
    if let Ok(resp) = api.client().head(url).send().await {
        if let Ok(resp) = resp.error_for_status() {
            if let Some(n) = resp.content_length() {
                return n;
            }
        }
    }
    tracing::debug!(
        "无法预先获取文件大小（多为镜像缺 Content-Range），进度按启发式估算: {}",
        url
    );
    1
}

fn hub_cache_from_config(config: &Config) -> Cache {
    match &config.hf_cache_dir {
        Some(p) => Cache::new(PathBuf::from(p)),
        None => Cache::from_env(),
    }
}

fn download_frac(downloaded: u64, total_bytes: Option<u64>) -> f64 {
    match total_bytes {
        Some(t) if t > 4096 => (downloaded as f64 / t as f64).min(0.99),
        _ => {
            let assumed = 250_u64 * 1024 * 1024;
            (downloaded as f64 / assumed as f64).min(0.99)
        }
    }
}

/// 流式下载上下文：`progress_base`～`progress_base + progress_span` 映射下载阶段占比。
struct HfHubStreamProgress<'a> {
    pool: &'a SqlitePool,
    job_id: &'a str,
    throttle: &'a mut ProgressThrottle,
    detail: &'a mut JobDetail,
    phase: &'static str,
    progress_base: f64,
    progress_span: f64,
    fname: &'a str,
}

/// 整文件 GET 写入 HF Hub 缓存布局（与 hf-hub 缓存兼容）；可选地在下载过程中节流更新任务进度。
async fn hf_stream_download_to_hub_cache(
    api: &hf_hub::api::tokio::Api,
    cache: &Cache,
    repo: &Repo,
    repo_api: &hf_hub::api::tokio::ApiRepo,
    commit_sha: &str,
    rfilename: &str,
    mut progress: Option<HfHubStreamProgress<'_>>,
) -> anyhow::Result<PathBuf> {
    let url = repo_api.url(rfilename);
    let resp = api.client().get(&url).send().await?;
    let resp = resp.error_for_status()?;

    if let Some(ref mut p) = progress {
        if let Some(cl) = resp.content_length() {
            if cl > 4096 {
                p.detail.total_bytes = Some(cl);
            }
        }
    }

    let mut stream = resp.bytes_stream();

    let cache_repo = cache.repo(repo.clone());
    let mut blobs_dir = cache_repo.blob_path("_placeholder");
    blobs_dir.pop();
    std::fs::create_dir_all(&blobs_dir)?;

    let tmp_path = blobs_dir.join(format!("_tmp_{}", Uuid::new_v4()));
    let mut file = tokio::fs::File::create(&tmp_path).await?;
    let mut hasher = sha1::Sha1::new();
    let mut downloaded: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;

        if let Some(ref mut p) = progress {
            p.detail.bytes_downloaded = Some(downloaded);
            let frac = download_frac(downloaded, p.detail.total_bytes);
            let prog_val = p.progress_base + frac * p.progress_span;
            let msg = match p.detail.total_bytes.filter(|&t| t > 4096) {
                Some(t) => format!(
                    "下载 {:.1}% ({:.1} / {:.1} MB) {}",
                    frac * 100.0,
                    downloaded as f64 / 1_048_576.0,
                    t as f64 / 1_048_576.0,
                    p.fname
                ),
                None => format!(
                    "已下载 {:.1} MB · {}",
                    downloaded as f64 / 1_048_576.0,
                    p.fname
                ),
            };
            p.throttle
                .maybe_update(p.pool, p.job_id, p.phase, prog_val, &msg, Some(p.detail), false)
                .await?;
        }
    }
    file.flush().await?;
    drop(file);

    let etag = hex::encode(hasher.finalize());
    let blob_path = cache_repo.blob_path(&etag);
    std::fs::create_dir_all(blob_path.parent().unwrap())?;

    if blob_path.exists() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
    } else {
        tokio::fs::rename(&tmp_path, &blob_path).await?;
    }

    let mut pointer_path = cache_repo.pointer_path(commit_sha);
    pointer_path.push(rfilename);
    std::fs::create_dir_all(pointer_path.parent().unwrap())?;

    if !pointer_path.exists() {
        if std::fs::hard_link(&blob_path, &pointer_path).is_err() {
            std::fs::copy(&blob_path, &pointer_path)?;
        }
    }

    cache_repo.create_ref(commit_sha)?;

    if let Some(ref mut p) = progress {
        let final_bytes = std::fs::metadata(&blob_path).map(|m| m.len()).unwrap_or(downloaded);
        p.detail.total_bytes = Some(final_bytes);
        p.detail.bytes_downloaded = Some(final_bytes);
        p.throttle
            .maybe_update(
                p.pool,
                p.job_id,
                p.phase,
                p.progress_base + p.progress_span,
                &format!("已写入 Hugging Face 缓存: {}", p.fname),
                Some(p.detail),
                true,
            )
            .await?;
    }

    Ok(pointer_path)
}

async fn download_ggml_model_from_hf(
    pool: &SqlitePool,
    config: &Config,
    job_id: &str,
    throttle: &mut ProgressThrottle,
    detail: &mut JobDetail,
    dest_file: &Path,
) -> anyhow::Result<PathBuf> {
    // 使用 from_env() 以读取 HF_ENDPOINT（镜像，例如 https://hf-mirror.com），
    // ApiBuilder::new() 固定 huggingface.co，在国内网络常导致请求失败。
    let mut builder = hf_hub::api::tokio::ApiBuilder::from_env().with_progress(false);
    if let Some(ref token) = config.hf_token {
        builder = builder.with_token(Some(token.clone()));
    }
    if let Some(ref cache) = config.hf_cache_dir {
        builder = builder.with_cache_dir(PathBuf::from(cache));
    }
    let api = builder
        .build()
        .map_err(|e| anyhow::anyhow!("HF Hub 初始化失败: {}", e))?;

    let hub_cache = hub_cache_from_config(config);

    let repo_id = config.whisper_hf_repo.trim().to_string();
    let fname = config.whisper_ggml_filename.trim().to_string();
    anyhow::ensure!(
        !fname.is_empty(),
        "WHISPER_GGML_FILE / whisper_ggml_filename 不能为空"
    );

    let repo = Repo::model(repo_id.clone());
    let repo_api = api.repo(repo.clone());
    let info = repo_api.info().await.map_err(|e| {
        anyhow::anyhow!(
            "读取 Hugging Face 模型信息失败: {}（若无法直连 huggingface.co，可设置环境变量 HF_ENDPOINT，例如国内镜像 https://hf-mirror.com）",
            e
        )
    })?;

    if info
        .siblings
        .iter()
        .find(|s| s.rfilename == fname)
        .is_none()
    {
        anyhow::bail!(
            "仓库 {} 中未找到文件 `{}`（请检查 WHISPER_HF_REPO 与 WHISPER_GGML_FILE）",
            repo_id,
            fname
        );
    }

    let url = repo_api.url(&fname);
    let total_hint = hub_file_byte_size(&api, &url).await;

    detail.total_bytes = Some(total_hint.max(1));
    detail.bytes_downloaded = Some(0);

    throttle
        .maybe_update(
            pool,
            job_id,
            "download_model",
            8.0,
            &format!("正在从 Hugging Face 流式下载 GGML 模型 {fname}"),
            Some(detail),
            true,
        )
        .await?;

    hf_stream_download_to_hub_cache(
        &api,
        &hub_cache,
        &repo,
        &repo_api,
        &info.sha,
        &fname,
        Some(HfHubStreamProgress {
            pool,
            job_id,
            throttle,
            detail,
            phase: "download_model",
            progress_base: 8.0,
            progress_span: 12.0,
            fname: fname.as_str(),
        }),
    )
    .await
    .map_err(|e| anyhow::anyhow!("下载 {} 失败: {}", fname, e))?;

    let cached_path = repo_api
        .get(&fname)
        .await
        .map_err(|e| anyhow::anyhow!("定位已下载文件 {} 失败: {}", fname, e))?;

    if let Some(parent) = dest_file.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::copy(&cached_path, dest_file)
        .await
        .map_err(|e| anyhow::anyhow!("复制模型到 {} 失败: {}", dest_file.display(), e))?;

    throttle
        .maybe_update(
            pool,
            job_id,
            "download_model",
            20.0,
            &format!("模型已下载至 {}", dest_file.display()),
            Some(detail),
            true,
        )
        .await?;

    throttle
        .maybe_update(
            pool,
            job_id,
            "ensure_model",
            20.0,
            "模型已就绪",
            Some(detail),
            true,
        )
        .await?;

    Ok(dest_file.to_path_buf())
}

async fn ensure_ffmpeg_bin(
    pool: &SqlitePool,
    config: &Config,
    job_id: &str,
    throttle: &mut ProgressThrottle,
    detail: &mut JobDetail,
) -> anyhow::Result<PathBuf> {
    let candidate = ffmpeg_bin(config);
    if ffmpeg_version_ok(Path::new(&candidate)).await {
        return Ok(PathBuf::from(candidate));
    }

    #[cfg(not(windows))]
    {
        if config.ffmpeg_auto_download {
            anyhow::bail!(
                "未找到可用的 ffmpeg；当前平台不支持自动下载，请安装 ffmpeg 或设置 FFMPEG_PATH"
            );
        }
        anyhow::bail!("未找到可用的 ffmpeg，请安装并配置 FFMPEG_PATH");
    }

    #[cfg(windows)]
    {
        if !config.ffmpeg_auto_download {
            anyhow::bail!(
                "未找到可用的 ffmpeg，请安装并配置 FFMPEG_PATH，或设置 FFMPEG_AUTO_DOWNLOAD=true"
            );
        }

        let base = config
            .ffmpeg_extract_dir
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("{}/ffmpeg", config.static_dir.trim()));
        let extract_root = PathBuf::from(base);
        tokio::fs::create_dir_all(&extract_root).await?;

        // Prefer reusing existing extracted ffmpeg to avoid re-downloading every run.
        // New layout: `<extract_root>/dist/**/ffmpeg.exe`
        // Legacy layout: `<extract_root>/unpacked/**/ffmpeg.exe`
        let dist_dir = extract_root.join("dist");
        if let Some(exe) = find_ffmpeg_executable(&dist_dir) {
            if ffmpeg_version_ok(&exe).await {
                return Ok(exe);
            }
        }
        let legacy_unpack_dir = extract_root.join("unpacked");
        if let Some(exe) = find_ffmpeg_executable(&legacy_unpack_dir) {
            if ffmpeg_version_ok(&exe).await {
                return Ok(exe);
            }
        }

        throttle
            .maybe_update(
                pool,
                job_id,
                "ensure_ffmpeg",
                22.0,
                "正在下载 ffmpeg（Windows 构建）",
                Some(detail),
                true,
            )
            .await?;

        let zip_path = extract_root.join("ffmpeg-release-essentials.download.zip");

        let url = config
            .ffmpeg_download_url
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| DEFAULT_FFMPEG_ZIP.to_string());

        download_file_progress(
            pool,
            job_id,
            throttle,
            detail,
            "download_ffmpeg",
            22.0,
            3.5,
            &url,
            &zip_path,
        )
        .await?;

        // Extracted result should live under `static/ffmpeg/dist` (or `${FFMPEG_EXTRACT_DIR}/dist`).
        if dist_dir.exists() {
            let _ = tokio::fs::remove_dir_all(&dist_dir).await;
        }
        tokio::fs::create_dir_all(&dist_dir).await?;

        let zip_clone = zip_path.clone();
        let unpack_clone = dist_dir.clone();
        tokio::task::spawn_blocking(move || extract_zip_sync(&zip_clone, &unpack_clone))
            .await??;

        let exe = find_ffmpeg_executable(&dist_dir)
            .ok_or_else(|| anyhow::anyhow!("解压后未找到 ffmpeg.exe"))?;

        throttle
            .maybe_update(
                pool,
                job_id,
                "ensure_ffmpeg",
                25.0,
                "ffmpeg 已就绪",
                Some(detail),
                true,
            )
            .await?;

        Ok(exe)
    }
}

async fn download_file_progress(
    pool: &SqlitePool,
    job_id: &str,
    throttle: &mut ProgressThrottle,
    detail: &mut JobDetail,
    phase: &str,
    base_progress: f64,
    span: f64,
    url: &str,
    dest: &Path,
) -> anyhow::Result<()> {
    let client = reqwest::Client::new();
    let head = client.head(url).send().await?;
    let total_bytes = head
        .headers()
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok()?.parse::<u64>().ok());

    detail.total_bytes = total_bytes;
    detail.bytes_downloaded = Some(0);

    let res = client.get(url).send().await?.error_for_status()?;
    let mut stream = res.bytes_stream();
    let tmp_path = dest.with_extension("part");
    let mut file = tokio::fs::File::create(&tmp_path).await?;
    let mut downloaded: u64 = 0;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        downloaded += chunk.len() as u64;
        file.write_all(&chunk).await?;
        detail.bytes_downloaded = Some(downloaded);

        let frac = total_bytes
            .map(|t| (downloaded as f64 / t as f64).min(1.0))
            .unwrap_or(0.0);
        let progress = base_progress + frac * span;
        let msg = total_bytes.map(|t| {
            format!(
                "下载 {:.1}% ({:.1} / {:.1} MB)",
                frac * 100.0,
                downloaded as f64 / 1_048_576.0,
                t as f64 / 1_048_576.0
            )
        }).unwrap_or_else(|| format!("已下载 {:.1} MB", downloaded as f64 / 1_048_576.0));

        throttle
            .maybe_update(pool, job_id, phase, progress, &msg, Some(detail), false)
            .await?;
    }
    file.sync_all().await?;
    drop(file);
    tokio::fs::rename(&tmp_path, dest).await?;
    Ok(())
}

fn extract_zip_sync(zip_path: &Path, out_dir: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(out_dir)?;
    let file = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let Some(rel) = file.enclosed_name() else {
            continue;
        };
        let outpath = out_dir.join(rel);
        if file.name().ends_with('/') {
            std::fs::create_dir_all(&outpath)?;
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut outfile = std::fs::File::create(&outpath)?;
            std::io::copy(&mut file, &mut outfile)?;
        }
    }
    Ok(())
}

fn find_ffmpeg_executable(root: &Path) -> Option<PathBuf> {
    fn walk(dir: &Path, depth: usize) -> Option<PathBuf> {
        if depth > 12 {
            return None;
        }
        let read = std::fs::read_dir(dir).ok()?;
        for e in read.flatten() {
            let p = e.path();
            if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                #[cfg(windows)]
                if name.eq_ignore_ascii_case("ffmpeg.exe") && p.is_file() {
                    return Some(p);
                }
                #[cfg(not(windows))]
                if name == "ffmpeg" && p.is_file() {
                    return Some(p);
                }
            }
            if p.is_dir() {
                if let Some(x) = walk(&p, depth + 1) {
                    return Some(x);
                }
            }
        }
        None
    }
    walk(root, 0)
}

async fn ffmpeg_version_ok(bin: &Path) -> bool {
    let out = tokio::process::Command::new(bin)
        .arg("-version")
        .output()
        .await;
    matches!(out, Ok(o) if o.status.success())
}

fn ffmpeg_bin(config: &Config) -> String {
    config
        .ffmpeg_path
        .clone()
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "ffmpeg".to_string())
}

async fn extract_audio_ffmpeg(
    config: &Config,
    ffmpeg_exe: &Path,
    video: &Path,
    out_wav: &Path,
) -> anyhow::Result<()> {
    let mut cmd = tokio::process::Command::new(ffmpeg_exe);
    cmd.arg("-nostdin")
        .arg("-hide_banner")
        .arg("-y")
        .arg("-i")
        .arg(video)
        .arg("-vn")
        .arg("-sn")
        .arg("-dn")
        .args(
            config
                .ffmpeg_audio_stream
                .map(|i| format!("0:a:{i}"))
                .into_iter()
                .flat_map(|m| ["-map".to_string(), m]),
        )
        .arg("-ar")
        .arg("16000")
        .arg("-ac")
        .arg("1")
        .args(
            config
                .ffmpeg_denoise_enable
                .then_some(("-af", config.ffmpeg_denoise_filter.trim()))
                .into_iter()
                .flat_map(|(k, v)| [k, v]),
        )
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(out_wav)
        .kill_on_drop(true);

    let out = cmd.output().await?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        if let Some(i) = config.ffmpeg_audio_stream {
            anyhow::bail!("ffmpeg 失败（FFMPEG_AUDIO_STREAM={i}）: {stderr}");
        }
        anyhow::bail!("ffmpeg 失败: {stderr}");
    }
    Ok(())
}

#[derive(Serialize, Deserialize)]
struct TPair {
    i: usize,
    t: String,
}

async fn translate_all_segments(
    pool: &SqlitePool,
    config: &Config,
    job_id: &str,
    throttle: &mut ProgressThrottle,
    detail: &mut JobDetail,
    segments: Vec<SubSegment>,
) -> anyhow::Result<Vec<SubSegment>> {
    let client = reqwest::Client::new();
    let total_lines = segments.len();
    const BATCH: usize = 24;
    let mut translated: Vec<String> = vec![String::new(); segments.len()];

    let indexed: Vec<(usize, String)> = segments
        .iter()
        .enumerate()
        .map(|(i, s)| (i, s.text.clone()))
        .collect();

    let batch_count = indexed.chunks(BATCH).count().max(1);

    for (bi, batch_items) in indexed.chunks(BATCH).enumerate() {
        let payload: Vec<TPair> = batch_items
            .iter()
            .map(|(i, t)| TPair {
                i: *i,
                t: t.clone(),
            })
            .collect();
        let user_json = serde_json::to_string(&payload)?;

        let body = serde_json::json!({
            "model": config.deepseek_model,
            "messages": [
                {"role": "system", "content": "你是字幕翻译助手。用户将提供 JSON 数组，每项为 {\"i\":序号,\"t\":\"原文\"}。请只输出一个 JSON 数组，每项为 {\"i\":序号,\"t\":\"简体中文译文\"}，序号与输入一致，不要输出任何解释或 Markdown。"},
                {"role": "user", "content": user_json}
            ],
            "temperature": 0.2
        });

        let url = format!(
            "{}/v1/chat/completions",
            config.deepseek_api_base.trim_end_matches('/')
        );

        let mut attempt = 0u32;
        loop {
            attempt += 1;
            let res = client
                .post(&url)
                .header(
                    reqwest::header::AUTHORIZATION,
                    format!("Bearer {}", config.deepseek_api_key.trim()),
                )
                .header(reqwest::header::CONTENT_TYPE, "application/json")
                .json(&body)
                .send()
                .await?;

            if !res.status().is_success() {
                let txt = res.text().await.unwrap_or_default();
                if attempt < 4 {
                    tokio::time::sleep(Duration::from_millis(400 * (1 << attempt))).await;
                    continue;
                }
                anyhow::bail!("DeepSeek 请求失败: {txt}");
            }

            let v: serde_json::Value = res.json().await?;
            let content = v["choices"][0]["message"]["content"]
                .as_str()
                .ok_or_else(|| anyhow::anyhow!("DeepSeek 响应缺少 content"))?;

            let parsed = parse_translation_json(content)?;
            for p in parsed {
                if p.i < translated.len() {
                    translated[p.i] = p.t;
                }
            }
            break;
        }

        let last_idx = batch_items.last().map(|(i, _)| *i).unwrap_or(0);
        detail.current_segment = Some((last_idx + 1) as u32);
        detail.total_segments = Some(total_lines as u32);
        let frac = (bi + 1) as f64 / batch_count as f64;
        let progress = 60.0 + frac * 34.0;
        throttle
            .maybe_update(
                pool,
                job_id,
                "translate",
                progress,
                &format!("翻译进度 {}/{} 批", bi + 1, batch_count),
                Some(detail),
                bi + 1 == batch_count,
            )
            .await?;
    }

    let mut out = Vec::new();
    for (i, seg) in segments.into_iter().enumerate() {
        let text = translated
            .get(i)
            .cloned()
            .filter(|s| !s.is_empty())
            .unwrap_or(seg.text.clone());
        out.push(SubSegment {
            t0_ms: seg.t0_ms,
            t1_ms: seg.t1_ms,
            text,
        });
    }
    Ok(out)
}

fn parse_translation_json(content: &str) -> anyhow::Result<Vec<TPair>> {
    let trimmed = strip_json_fence(content.trim());
    let arr: Vec<TPair> = serde_json::from_str(trimmed).map_err(|e| {
        anyhow::anyhow!(
            "解析翻译 JSON 失败: {e}; 原始片段: {}",
            trimmed.chars().take(400).collect::<String>()
        )
    })?;
    Ok(arr)
}

fn strip_json_fence(s: &str) -> &str {
    let s = s.trim();
    if let Some(rest) = s.strip_prefix("```") {
        let rest = rest.trim_start_matches("json").trim_start_matches("JSON");
        let rest = rest.trim();
        if let Some(end) = rest.rfind("```") {
            return rest[..end].trim();
        }
    }
    s
}

fn build_srt(segments: &[SubSegment]) -> String {
    let mut s = String::new();
    for (idx, seg) in segments.iter().enumerate() {
        let n = idx + 1;
        let start = format_srt_timestamp(seg.t0_ms);
        let end = format_srt_timestamp(seg.t1_ms);
        s.push_str(&format!("{n}\n{start} --> {end}\n{}\n\n", seg.text));
    }
    s
}

fn format_srt_timestamp(ms: i64) -> String {
    let ms = ms.max(0);
    let h = ms / 3_600_000;
    let m = (ms % 3_600_000) / 60_000;
    let s = (ms % 60_000) / 1000;
    let milli = ms % 1000;
    format!("{:02}:{:02}:{:02},{:03}", h, m, s, milli)
}
