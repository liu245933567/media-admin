use crate::config::Config;
use crate::generation_job::{self, JobDetail, ProgressThrottle};
use crate::whisper_transcribe;
use futures_util::StreamExt;
use hf_hub::Cache;
use hf_hub::Repo;
use hf_hub::api::tokio::ApiError;
use serde::{Deserialize, Serialize};
use sha1::Digest;
use sqlx::SqlitePool;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;
use uuid::Uuid;

use faster_whisper_rs::config::WhisperConfig;

const THROTTLE_MS: u64 = 350;

/// CTranslate2 权重：`model.bin` 或分片索引（仅有 config.json 不完整时会无法加载）。
fn ct2_weights_present(dir: &Path) -> bool {
    let bin = dir.join("model.bin");
    if bin.is_file() {
        // Git LFS 未拉取时可能是百余字节的指针文件，CTRanslate2 无法打开
        if let Ok(meta) = bin.metadata() {
            if meta.len() < 4096 {
                if let Ok(head) = std::fs::read_to_string(&bin) {
                    if head.starts_with("version https://git-lfs.github.com") {
                        tracing::warn!(
                            path = %bin.display(),
                            "model.bin 为 Git LFS 指针，请执行 git lfs pull 或下载真实权重"
                        );
                        return false;
                    }
                }
            }
        }
        return true;
    }
    dir.join("model.bin.index.json").is_file()
}

fn ct2_local_model_ready(dir: &Path) -> bool {
    dir.join("config.json").is_file() && ct2_weights_present(dir)
}

/// 在 `base` 或其一级、二级子目录中查找同时含 config.json 与权重的 CT2 快照根目录。
fn resolve_ct2_model_dir(base: &Path) -> Option<PathBuf> {
    if ct2_local_model_ready(base) {
        return Some(base.to_path_buf());
    }
    let rd = std::fs::read_dir(base).ok()?;
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        if ct2_local_model_ready(&p) {
            return Some(p);
        }
        let rd2 = std::fs::read_dir(&p).ok()?;
        for e2 in rd2.flatten() {
            let p2 = e2.path();
            if p2.is_dir() && ct2_local_model_ready(&p2) {
                return Some(p2);
            }
        }
    }
    None
}

/// Python / CTranslate2 在部分环境下对 `\\?\` 规范化路径兼容性差，传给 Whisper 时用普通绝对路径更稳。
fn whisper_model_path_for_python(model_dir: &Path) -> String {
    let p = model_dir.canonicalize().unwrap_or_else(|_| model_dir.to_path_buf());
    let s = p.to_string_lossy().to_string();
    #[cfg(windows)]
    {
        return s
            .strip_prefix(r"\\?\")
            .map(str::to_owned)
            .unwrap_or(s);
    }
    #[cfg(not(windows))]
    s
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
    // --- Model (CTranslate2 snapshot via HF) ---
    throttle
        .maybe_update(
            pool,
            job_id,
            "ensure_model",
            5.0,
            "检查 faster-whisper 模型",
            Some(detail),
            true,
        )
        .await?;

    let user_model_dir = PathBuf::from(config.whisper_model_path.trim());
    let resolved_local = resolve_ct2_model_dir(&user_model_dir);
    if resolved_local.is_none()
        && user_model_dir.join("config.json").is_file()
        && !ct2_weights_present(&user_model_dir)
    {
        tracing::warn!(
            path = %user_model_dir.display(),
            "配置指向的目录含 config.json 但缺少可用 model.bin（或在子目录）；未找到子目录快照时将改为从 Hugging Face 下载"
        );
    }

    let model_dir = if let Some(dir) = resolved_local {
        tracing::info!(
            configured = %user_model_dir.display(),
            resolved = %dir.display(),
            "使用本地 CTranslate2 模型目录"
        );
        throttle
            .maybe_update(
                pool,
                job_id,
                "ensure_model",
                20.0,
                "使用本地模型目录",
                Some(detail),
                true,
            )
            .await?;
        dir.canonicalize().unwrap_or(dir)
    } else {
        let _guard = model_lock.lock().await;
        let retry_dir = PathBuf::from(config.whisper_model_path.trim());
        if let Some(dir) = resolve_ct2_model_dir(&retry_dir) {
            tracing::info!(
                configured = %retry_dir.display(),
                resolved = %dir.display(),
                "使用本地 CTranslate2 模型目录（获取锁后解析）"
            );
            throttle
                .maybe_update(
                    pool,
                    job_id,
                    "ensure_model",
                    20.0,
                    "使用本地模型目录",
                    Some(detail),
                    true,
                )
                .await?;
            dir.canonicalize().unwrap_or(dir)
        } else {
            download_ct2_model_from_hf(pool, config, job_id, throttle, detail).await?
        }
    };

    let model_dir_str = whisper_model_path_for_python(&model_dir);

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
    extract_audio_ffmpeg(&ffmpeg_exe, video, &audio_tmp).await?;

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
            "faster-whisper 转写中（见下方实时日志）",
            Some(detail),
            true,
        )
        .await?;

    let device = config.whisper_device.clone();
    let compute = config.whisper_compute_type.clone();
    let model_dir_for = model_dir_str.clone();
    let wav_for_task = wav_str.clone();
    let whisper_cfg = WhisperConfig::default();

    let shared_logs: std::sync::Arc<std::sync::Mutex<Vec<String>>> =
        std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
    let shared_logs_worker = shared_logs.clone();

    let mut transcribe_jh = tokio::task::spawn_blocking(move || {
        let cap: usize = 500;
        let mut push = |line: String| {
            let mut g = shared_logs_worker.lock().unwrap();
            g.push(line);
            if g.len() > cap {
                let n = g.len() - cap;
                g.drain(0..n);
            }
        };
        whisper_transcribe::transcribe_wav_with_logs(
            model_dir_for,
            wav_for_task,
            device,
            compute,
            whisper_cfg,
            &mut push,
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
        anyhow::bail!("未识别到语音内容");
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
           VALUES (?, ?, 'local_faster_whisper', 'zh', 'srt')"#,
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

/// hf-hub 的 `metadata()` 要求响应含 `Content-Range`；部分 HF 镜像未返回该头（会报 Header content-range is missing）。
/// 依次尝试：官方 metadata → HEAD 的 Content-Length → 占位 1 字节（仅用于进度占比，避免 total 为 0）。
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
        "无法预先获取文件大小（多为镜像缺 Content-Range），进度按文件数估算: {}",
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

/// `hf-hub` 的 `download()` 会先调 `metadata()`（依赖 Content-Range）；镜像失败时走整文件 GET，按 hub 布局写入 blobs/snapshots。
fn is_hf_range_metadata_error(e: &ApiError) -> bool {
    e.to_string().to_ascii_lowercase().contains("content-range")
}

async fn hf_stream_download_to_hub_cache(
    api: &hf_hub::api::tokio::Api,
    cache: &Cache,
    repo: &Repo,
    repo_api: &hf_hub::api::tokio::ApiRepo,
    commit_sha: &str,
    rfilename: &str,
) -> anyhow::Result<PathBuf> {
    let url = repo_api.url(rfilename);
    let resp = api.client().get(&url).send().await?;
    let resp = resp.error_for_status()?;
    let mut stream = resp.bytes_stream();

    let cache_repo = cache.repo(repo.clone());
    let mut blobs_dir = cache_repo.blob_path("_placeholder");
    blobs_dir.pop();
    std::fs::create_dir_all(&blobs_dir)?;

    let tmp_path = blobs_dir.join(format!("_tmp_{}", Uuid::new_v4()));
    let mut file = tokio::fs::File::create(&tmp_path).await?;
    let mut hasher = sha1::Sha1::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        hasher.update(&chunk);
        file.write_all(&chunk).await?;
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

    Ok(pointer_path)
}

async fn download_ct2_model_from_hf(
    pool: &SqlitePool,
    config: &Config,
    job_id: &str,
    throttle: &mut ProgressThrottle,
    detail: &mut JobDetail,
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
    let repo = Repo::model(repo_id.clone());
    let repo_api = api.repo(repo.clone());
    let info = repo_api.info().await.map_err(|e| {
        anyhow::anyhow!(
            "读取 Hugging Face 模型信息失败: {}（若无法直连 huggingface.co，可设置环境变量 HF_ENDPOINT，例如国内镜像 https://hf-mirror.com）",
            e
        )
    })?;

    if info.siblings.is_empty() {
        anyhow::bail!("Hugging Face 仓库没有可下载的文件: {}", repo_id);
    }

    let mut total_bytes: u64 = 0;
    let mut sizes: Vec<(String, u64)> = Vec::with_capacity(info.siblings.len());
    for s in &info.siblings {
        let url = repo_api.url(&s.rfilename);
        let sz = hub_file_byte_size(&api, &url).await;
        total_bytes += sz;
        sizes.push((s.rfilename.clone(), sz));
    }

    detail.total_bytes = Some(total_bytes);
    detail.bytes_downloaded = Some(0);

    throttle
        .maybe_update(
            pool,
            job_id,
            "download_model",
            8.0,
            "正在从 Hugging Face 下载 CTranslate2 模型",
            Some(detail),
            true,
        )
        .await?;

    let mut done: u64 = 0;
    let n = info.siblings.len().max(1);
    for (i, s) in info.siblings.iter().enumerate() {
        let frac_start = done as f64 / total_bytes.max(1) as f64;
        let progress = 8.0 + frac_start * 12.0;
        throttle
            .maybe_update(
                pool,
                job_id,
                "download_model",
                progress,
                &format!(
                    "下载模型文件 {}/{}: {}",
                    i + 1,
                    n,
                    s.rfilename
                ),
                Some(detail),
                false,
            )
            .await?;

        match repo_api.download(&s.rfilename).await {
            Ok(_) => {}
            Err(e) if is_hf_range_metadata_error(&e) => {
                tracing::debug!(
                    "hf-hub 分片下载依赖 Content-Range，改用整文件流式写入缓存: {}",
                    s.rfilename
                );
                hf_stream_download_to_hub_cache(
                    &api,
                    &hub_cache,
                    &repo,
                    &repo_api,
                    &info.sha,
                    &s.rfilename,
                )
                .await
                .map_err(|e2| {
                    anyhow::anyhow!(
                        "下载 {} 失败（镜像缺少 Content-Range，整文件回退仍失败）: {}",
                        s.rfilename,
                        e2
                    )
                })?;
            }
            Err(e) => {
                return Err(anyhow::anyhow!("下载 {} 失败: {}", s.rfilename, e));
            }
        }

        if let Some((_, sz)) = sizes.iter().find(|(n, _)| n == &s.rfilename) {
            done += sz;
        }
        detail.bytes_downloaded = Some(done);
        let frac = done as f64 / total_bytes.max(1) as f64;
        let progress = 8.0 + frac * 12.0;
        throttle
            .maybe_update(
                pool,
                job_id,
                "download_model",
                progress,
                &format!(
                    "已下载 {:.1}% ({:.1} / {:.1} MB)",
                    frac * 100.0,
                    done as f64 / 1_048_576.0,
                    total_bytes as f64 / 1_048_576.0
                ),
                Some(detail),
                false,
            )
            .await?;
    }

    let cfg_path = repo_api
        .get("config.json")
        .await
        .map_err(|e| anyhow::anyhow!("定位 config.json 失败: {}", e))?;
    let model_dir = cfg_path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("无效模型路径"))?
        .to_path_buf();

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

    Ok(model_dir)
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

        let base = config
            .ffmpeg_extract_dir
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "tools/ffmpeg-dist".to_string());
        let extract_root = PathBuf::from(base);
        tokio::fs::create_dir_all(&extract_root).await?;

        let zip_path = extract_root.join("ffmpeg-release-essentials.download.zip");
        let unpack_dir = extract_root.join("unpacked");

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

        if unpack_dir.exists() {
            let _ = tokio::fs::remove_dir_all(&unpack_dir).await;
        }
        tokio::fs::create_dir_all(&unpack_dir).await?;

        let zip_clone = zip_path.clone();
        let unpack_clone = unpack_dir.clone();
        tokio::task::spawn_blocking(move || extract_zip_sync(&zip_clone, &unpack_clone))
            .await??;

        let exe = find_ffmpeg_executable(&unpack_dir)
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
    ffmpeg_exe: &Path,
    video: &Path,
    out_wav: &Path,
) -> anyhow::Result<()> {
    let mut cmd = tokio::process::Command::new(ffmpeg_exe);
    cmd.arg("-nostdin")
        .arg("-y")
        .arg("-i")
        .arg(video)
        .arg("-ar")
        .arg("16000")
        .arg("-ac")
        .arg("1")
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(out_wav)
        .kill_on_drop(true);

    let out = cmd.output().await?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
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
