/// 字幕翻译配置：包装 [`TranslateOptions`] + 可选 API key。
///
/// 在 [`generate_subtitle_with`] 中传入 `Some(...)` 即可在生成原文 SRT 后
/// 自动调用 LLM 翻译，输出 `<stem>.<lang>.srt`。
#[derive(Deserialize)]
pub struct SubtitleTranslateConfig {
    /// 翻译参数（模型、目标语言、并发、批量大小）
    pub options: TranslateOptions,
    /// 是否在翻译完成后删除原文 SRT。默认 `false`，两份文件并存便于核对。
    pub remove_source_srt: bool,
}