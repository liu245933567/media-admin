CREATE TABLE IF NOT EXISTS subtitle_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_path TEXT NOT NULL,
    subtitle_path TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'xunlei',
    language TEXT,
    format TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
