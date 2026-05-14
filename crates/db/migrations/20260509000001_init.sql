CREATE TABLE IF NOT EXISTS subtitle_task (
    task_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    task_status TEXT NOT NULL,
    video_path TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subtitle_task_record (
    record_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    record_status TEXT NOT NULL,
    record_desc TEXT NOT NULL,
    record_detail TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS generated_subtitles (
    subtitle_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    subtitle_path TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subtitle_translate_task (
    task_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    task_status TEXT NOT NULL,
    source_srt_path TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS subtitle_translate_task_record (
    record_id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    record_status TEXT NOT NULL,
    record_desc TEXT NOT NULL,
    record_detail TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
