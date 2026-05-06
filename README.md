# 字幕管理工具

## 技术栈

### 后台

语言: rust
数据库: sqlite
所用库: axum

### 前端

语言: typescript
所用库: react tanstack-router tanstack-query tailwindcss antd @antd/pro-components

## 功能

### 字幕下载

实现思路:
通过文本框输入视频路径，根据文件信息调用迅雷字幕api查询字幕;
查出后将字幕列表显示在页面上让用户选择，用户选择完毕后，将字幕下载到本地，并重命名成与视频文件同名;
下载到本地完毕后，在数据库中生成一条记录

## 本地运行

### 前提

- 输入的「视频路径」必须是**运行后端的机器**上可访问的**绝对路径**（后端会读取该文件以计算迅雷 CID，并将字幕保存到与视频同一路径下的同名主文件名）。

### 后端

```bash
cd backend
cargo run
```

默认监听 `127.0.0.1:3000`，SQLite 文件为工作目录下的 `subtitle_admin.db`（若不存在会自动创建并执行迁移）。

### 前端

```bash
cd frontend
npm install
npm run dev
```

开发环境将 `http://127.0.0.1:5173` 的 `/api`、`/health` 代理到后端 `http://127.0.0.1:3000`。

### 常用环境变量（可选）

| 变量 | 说明 | 默认 |
| --- | --- | --- |
| `DATABASE_URL` | sqlx SQLite 连接串 | `sqlite://./subtitle_admin.db` |
| `SUBTITLE_ADMIN_HOST` / `SUBTITLE_ADMIN_PORT` | 服务监听 | `127.0.0.1` / `3000` |
| `XUNLEI_SUBTITLE_BASE` | 迅雷 oracle 基础 URL | `https://api-shoulei-ssl.xunlei.com/oracle/subtitle` |
| `SUBTITLE_ADMIN_CORS_ORIGINS` | 浏览器 Origin，逗号分隔 | `http://localhost:5173,http://127.0.0.1:5173` |
| `VITE_API_URL`（前端构建或直连 API 时） | 请求前缀；开发留空即可走 Vite 代理 | 空 |

## 开发插件
CUDA Toolkit
https://developer.nvidia.com/cuda-downloads
