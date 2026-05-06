CREATE TABLE IF NOT EXISTS subtitle_generation_jobs (
    id TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL,
    phase TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    detail_json TEXT,
    video_path TEXT,
    subtitle_path TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_subtitle_generation_jobs_status
    ON subtitle_generation_jobs (status);

CREATE INDEX IF NOT EXISTS idx_subtitle_generation_jobs_video
    ON subtitle_generation_jobs (video_path);
