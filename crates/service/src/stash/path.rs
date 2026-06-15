use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Stash 文件路径到本服务本地路径的前缀映射。
#[typeshare::typeshare]
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct StashPathMapping {
    /// Stash 返回的文件路径前缀。
    pub stash_prefix: String,
    /// 本服务运行环境可访问的本地路径前缀。
    pub local_prefix: String,
}

/// 按配置把 Stash 文件路径转换成本服务可访问的本地路径。
pub fn map_stash_file_path(path: &str, mappings: &[StashPathMapping]) -> Option<String> {
    let raw = path.trim();
    if raw.is_empty() {
        return None;
    }

    let path_key = normalize_match_key(raw);
    let mut matched: Option<(&StashPathMapping, usize)> = None;

    for mapping in mappings {
        let stash_prefix = mapping.stash_prefix.trim();
        let local_prefix = mapping.local_prefix.trim();
        if stash_prefix.is_empty() || local_prefix.is_empty() {
            continue;
        }

        let prefix_key = normalize_match_key(stash_prefix);
        if !is_path_prefix_match(&path_key, &prefix_key) {
            continue;
        }

        let score = prefix_key.len();
        if matched.is_none_or(|(_, current)| score > current) {
            matched = Some((mapping, score));
        }
    }

    if let Some((mapping, _)) = matched {
        return Some(join_mapped_path(
            mapping.local_prefix.trim(),
            suffix_after_prefix(raw, mapping.stash_prefix.trim()),
        ));
    }

    if Path::new(raw).exists() {
        return Some(raw.to_string());
    }

    None
}

fn normalize_match_key(path: &str) -> String {
    let mut value = path.trim().replace('\\', "/");
    while value.len() > 1 && value.ends_with('/') {
        value.pop();
    }
    if cfg!(windows) {
        value = value.to_ascii_lowercase();
    }
    value
}

fn is_path_prefix_match(path: &str, prefix: &str) -> bool {
    path == prefix
        || path
            .strip_prefix(prefix)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn suffix_after_prefix<'a>(path: &'a str, prefix: &str) -> &'a str {
    let prefix_chars = prefix.chars().count();
    let byte_index = path
        .char_indices()
        .nth(prefix_chars)
        .map(|(idx, _)| idx)
        .unwrap_or(path.len());
    path.get(byte_index..)
        .unwrap_or_default()
        .trim_start_matches(['/', '\\'])
}

fn join_mapped_path(local_prefix: &str, suffix: &str) -> String {
    if suffix.is_empty() {
        return local_prefix.to_string();
    }

    let mut out = PathBuf::from(local_prefix);
    for part in suffix.replace('\\', "/").split('/') {
        if part.is_empty() {
            continue;
        }
        if Path::new(part).components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        }) {
            continue;
        }
        out.push(part);
    }
    out.to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_with_longest_prefix_first() {
        let mappings = vec![
            StashPathMapping {
                stash_prefix: "/mnt/media".to_string(),
                local_prefix: "D:\\media".to_string(),
            },
            StashPathMapping {
                stash_prefix: "/mnt/media/4k".to_string(),
                local_prefix: "E:\\4k".to_string(),
            },
        ];

        assert_eq!(
            map_stash_file_path("/mnt/media/4k/a/b.mp4", &mappings).as_deref(),
            Some("E:\\4k\\a\\b.mp4"),
        );
    }

    #[test]
    fn ignores_partial_prefix_match() {
        let mappings = vec![StashPathMapping {
            stash_prefix: "/mnt/media".to_string(),
            local_prefix: "D:\\media".to_string(),
        }];

        assert_eq!(map_stash_file_path("/mnt/media-old/a.mp4", &mappings), None);
    }
}
