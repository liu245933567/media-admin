use super::types::WhisperModelItem;

const HF_BASE: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

pub fn whisper_catalog() -> Vec<WhisperModelItem> {
    vec![
        WhisperModelItem {
            id: "tiny".into(),
            label: "Tiny".into(),
            filename: "ggml-tiny.bin".into(),
            description: "最快，精度最低".into(),
            size_hint: "~75 MiB".into(),
            local_ready: false,
        },
        WhisperModelItem {
            id: "base".into(),
            label: "Base".into(),
            filename: "ggml-base.bin".into(),
            description: "轻量".into(),
            size_hint: "~142 MiB".into(),
            local_ready: false,
        },
        WhisperModelItem {
            id: "small".into(),
            label: "Small".into(),
            filename: "ggml-small.bin".into(),
            description: "平衡".into(),
            size_hint: "~466 MiB".into(),
            local_ready: false,
        },
        WhisperModelItem {
            id: "medium".into(),
            label: "Medium".into(),
            filename: "ggml-medium.bin".into(),
            description: "较高精度".into(),
            size_hint: "~1.5 GiB".into(),
            local_ready: false,
        },
        WhisperModelItem {
            id: "large-v3".into(),
            label: "Large v3".into(),
            filename: "ggml-large-v3.bin".into(),
            description: "默认任务配置常用".into(),
            size_hint: "~3.1 GiB".into(),
            local_ready: false,
        },
        WhisperModelItem {
            id: "large-v3-turbo".into(),
            label: "Large v3 Turbo".into(),
            filename: "ggml-large-v3-turbo.bin".into(),
            description: "large-v3 的加速变体".into(),
            size_hint: "~1.5 GiB".into(),
            local_ready: false,
        },
    ]
}

pub fn whisper_download_url(filename: &str) -> String {
    format!("{HF_BASE}/{filename}")
}
