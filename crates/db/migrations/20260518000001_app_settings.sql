-- 应用级键值设置（已废弃，由 20260519000001 删除）
CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
);
