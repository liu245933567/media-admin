//! 与 `faster-whisper-rs` 内嵌脚本等价的转写逻辑，但通过生成器逐段产出日志。
use anyhow::Context;
use faster_whisper_rs::config::WhisperConfig;
use pyo3::prelude::*;
use pyo3::types::PyModule;
use pyo3::types::PyDict;

#[derive(Debug, Clone)]
pub struct TimedText {
    pub t0_ms: i64,
    pub t1_ms: i64,
    pub text: String,
}

fn convert_opt<T: ToString>(v: Option<T>) -> String {
    match v {
        Some(x) => x.to_string(),
        None => "None".to_string(),
    }
}

const SCRIPT: &str = r#"
from faster_whisper import WhisperModel

def new_model(model_path, device, compute):
    return WhisperModel(model_path, device=device, compute_type=compute)

def transcribe_start(
    model,
    path,
    prompt,
    prefix,
    language,
    beam_size,
    best_of,
    patience,
    length_penalty,
    chunk_length,
    vad,
):
    if isinstance(language, str) and language == "None":
        language = None
    if isinstance(prompt, str) and prompt == "None":
        prompt = None
    if isinstance(prefix, str) and prefix == "None":
        prefix = None

    ms = vad[3]
    if ms == "None":
        max_speech_s = float("inf")
    else:
        try:
            max_speech_s = float(ms) / 100.0
        except (TypeError, ValueError):
            max_speech_s = float("inf")

    vad_par = dict(
        threshold=vad[1],
        min_speech_duration_ms=vad[2],
        max_speech_duration_s=max_speech_s,
        min_silence_duration_ms=vad[4],
        speech_pad_ms=vad[5],
    )

    segments, info = model.transcribe(
        audio=path,
        beam_size=beam_size if beam_size > 0 else 5,
        best_of=best_of if best_of > 0 else 5,
        patience=patience if patience > 0 else 1,
        length_penalty=length_penalty if length_penalty > 0 else 1,
        language="en" if language is None else language,
        prefix=None if prefix is None else prefix,
        chunk_length=None if chunk_length == "None" else chunk_length,
        initial_prompt=None if prompt is None else prompt,
        vad_filter=vad[0],
        vad_parameters=vad_par,
    )
    return segments, info
"#;

/// 在持有 GIL 的线程中调用（通常放在 `spawn_blocking` 内）。
pub fn transcribe_wav_with_logs(
    model_dir: String,
    wav_path: String,
    device: String,
    compute_type: String,
    cfg: WhisperConfig,
    push_log: &mut dyn FnMut(String),
) -> anyhow::Result<Vec<TimedText>> {
    Python::with_gil(|py| -> anyhow::Result<Vec<TimedText>> {
        // 记录当前嵌入的 Python 解释器，便于定位“命令行能用但后端不能用”的环境差异。
        if let Ok(sys) = py.import_bound("sys") {
            let exe: String = sys
                .getattr("executable")
                .ok()
                .and_then(|v| v.extract().ok())
                .unwrap_or_else(|| "?".into());
            let ver: String = sys
                .getattr("version")
                .ok()
                .and_then(|v| v.extract().ok())
                .unwrap_or_else(|| "?".into());
            push_log(format!("[Env] Python executable: {exe}"));
            push_log(format!("[Env] Python version: {ver}"));
        }

        // Windows + CUDA 时，提前探测 cublas DLL 是否可加载，给出更清晰的错误与建议。
        #[cfg(windows)]
        if device.trim().eq_ignore_ascii_case("cuda") {
            // 注意：`eval` 只能执行表达式；这里用 `run` 执行 try/except 语句块。
            let code = r#"
import ctypes
ok = False
err = ""
try:
    ctypes.CDLL("cublas64_12.dll")
    ok = True
except OSError as e:
    ok = False
    err = str(e)
"#;
            let locals = PyDict::new_bound(py);
            match py.run_bound(code, None, Some(&locals)) {
                Ok(()) => {
                    let ok: bool = locals
                        .get_item("ok")
                        .ok()
                        .flatten()
                        .and_then(|x| x.extract().ok())
                        .unwrap_or(false);
                    let err: String = locals
                        .get_item("err")
                        .ok()
                        .flatten()
                        .and_then(|x| x.extract().ok())
                        .unwrap_or_default();
                    if ok {
                        push_log("[Env] 已成功加载 cublas64_12.dll（CUDA runtime 就绪）".to_string());
                    } else {
                        push_log(format!("[Env] 无法加载 cublas64_12.dll：{err}"));
                        anyhow::bail!(
                            "GPU 环境缺少或无法加载 cublas64_12.dll。请确认已安装 CUDA 12 runtime（含 cuBLAS），并将 CUDA 的 bin 目录加入 PATH 后重启后端进程。"
                        );
                    }
                }
                Err(e) => push_log(format!("[Env] cublas 探测失败：{e}")),
            };
        }

        let module = PyModule::from_code_bound(py, SCRIPT, "sa_whisper.py", "sa_whisper")
            .context("加载内嵌 Whisper Python 模块")?;

        let new_model = module
            .getattr("new_model")
            .context("new_model")?;
        let model = new_model
            .call1((model_dir.as_str(), device.as_str(), compute_type.as_str()))
            .context("WhisperModel(...)")?;

        let vad = (
            cfg.vad.active,
            cfg.vad.threshold,
            cfg.vad.min_speech_duration,
            convert_opt(cfg.vad.max_speech_duration),
            cfg.vad.min_silence_duration,
            cfg.vad.padding_duration,
        );

        let args = (
            model,
            wav_path.as_str(),
            convert_opt(cfg.starting_prompt.clone()),
            convert_opt(cfg.prefix.clone()),
            convert_opt(cfg.language.clone()),
            cfg.beam_size,
            cfg.best_of,
            cfg.patience,
            cfg.length_penalty,
            convert_opt(cfg.chunk_length.clone()),
            vad,
        );

        let start = module
            .getattr("transcribe_start")
            .context("transcribe_start")?;
        let pair = start.call1(args).context("transcribe_start(...)")?;

        let info = pair.get_item(1).context("transcription info")?;
        let lang: String = info.getattr("language")?.extract().unwrap_or_else(|_| "?".into());
        let prob: f64 = info
            .getattr("language_probability")
            .ok()
            .and_then(|o| o.extract().ok())
            .unwrap_or(0.0);
        let dur: f64 = info
            .getattr("duration")
            .ok()
            .and_then(|o| o.extract().ok())
            .unwrap_or(0.0);
        push_log(format!(
            "[Whisper] 音频时长约 {:.1}s，检测语言 {}（置信度 {:.0}%）",
            dur,
            lang,
            prob * 100.0
        ));

        let gen = pair.get_item(0).context("segments generator")?;
        let mut out = Vec::new();
        let seg_iter = gen
            .iter()
            .context("segments 不可迭代（transcribe 未返回生成器）")?;

        for item in seg_iter {
            let seg = item.context("读取片段")?;
            let id: i32 = seg.getattr("id")?.extract().unwrap_or(-1);
            let start: f64 = seg.getattr("start")?.extract().unwrap_or(0.0);
            let end: f64 = seg.getattr("end")?.extract().unwrap_or(0.0);
            let text: String = seg
                .getattr("text")
                .and_then(|t| t.extract())
                .unwrap_or_default();
            let preview = text.trim().replace('\n', " ");
            let short = if preview.chars().count() > 72 {
                format!("{}…", preview.chars().take(72).collect::<String>())
            } else {
                preview.clone()
            };
            push_log(format!(
                "[Whisper] 片段 #{} [{:.2}s – {:.2}s] {}",
                id, start, end, short
            ));

            out.push(TimedText {
                t0_ms: (start * 1000.0) as i64,
                t1_ms: (end * 1000.0) as i64,
                text: text.trim().to_string(),
            });
        }

        push_log(format!("[Whisper] 转写结束，共 {} 段", out.len()));
        Ok(out)
    })
}
