# Media Admin

Media Admin 是一个面向本地媒体与字幕工作流的管理工具。项目同时提供 Web 管理界面、Rust HTTP 服务，以及基于 Tauri 的桌面端。

## 功能概览

- 本地视频播放与浏览器端转码播放
- 视频字幕生成、识别、翻译与任务队列管理
- Whisper 模型与 FFmpeg 工具下载配置
- Stash 场景浏览与字幕处理
- Emby 媒体库浏览、播放与字幕搜索
- SQLite 本地数据持久化

## 技术栈

### 后端

- Rust workspace
- Axum HTTP 服务
- SQLite / SQLx
- Taskmill 任务调度
- Whisper / FFmpeg 相关媒体处理能力
- Utoipa 导出 OpenAPI

### 前端

- React 19 + TypeScript
- Vite
- TanStack Router / TanStack Query / TanStack Table
- HeroUI / HeroUI Pro
- Tailwind CSS v4
- Orval 基于 OpenAPI 生成 API 请求与 Zod schema
- Video.js

### 桌面端

- Tauri v2
- 内嵌 Rust API 服务
- 开发期加载 Vite，生产期加载仓库根目录 `dist/`

## 目录结构

```text
.
├─ apps
│  ├─ web          # React Web 前端
│  ├─ server       # 独立 HTTP 服务入口
│  └─ desktop      # Tauri 桌面端
├─ crates
│  ├─ api          # Axum 路由、OpenAPI、服务装配
│  ├─ db           # SQLite 连接与迁移
│  ├─ service      # 业务服务、任务调度、Stash/Emby/下载逻辑
│  ├─ subtitle     # 字幕生成、翻译、文件处理
│  ├─ utils        # 配置、日志、通用类型
│  └─ whisper      # Whisper 推理封装
├─ dist            # Web 构建产物，供 Axum/Tauri 生产模式加载
├─ Cargo.toml      # Rust workspace 配置
└─ package.json    # pnpm workspace 脚本入口
```

## 环境要求

- Node.js 与 pnpm
- Rust stable toolchain
- Tauri 桌面端所需系统依赖
- FFmpeg：可通过设置页下载，也可手动放到 `FFMPEG_DIR`
- CUDA Toolkit：仅在启用 `cuda` feature 时需要

CUDA Toolkit 下载地址：[https://developer.nvidia.com/cuda-downloads](https://developer.nvidia.com/cuda-downloads)

## 安装依赖

在仓库根目录执行：

```bash
pnpm install
```

Rust 依赖由 Cargo 在首次构建或运行时自动拉取。

## 开发启动

### Web + 独立服务

分别启动后端与前端：

```bash
pnpm server:dev
pnpm web:dev
```

- API 服务默认监听 `http://127.0.0.1:14200`
- Web 开发服务固定监听 `http://127.0.0.1:5173`
- Vite 已将 `/api` 代理到 `127.0.0.1:14200`

如需启用 CUDA：

```bash
pnpm server:dev:cuda
pnpm web:dev
```

### 桌面端

```bash
pnpm desktop:dev
```

桌面端开发模式会通过 Tauri 的 `beforeDevCommand` 启动 Web 开发服务，并在 Tauri 进程内启动 API 服务。

启用 CUDA：

```bash
pnpm desktop:dev:cuda
```

## 构建

### Web

```bash
pnpm web:build
```

构建产物输出到仓库根目录 `dist/`。

### 后端服务

```bash
pnpm server:build
```

### 桌面端

```bash
pnpm desktop:build
```

启用 CUDA：

```bash
pnpm desktop:build:cuda
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `pnpm web:dev` | 启动前端 Vite 开发服务 |
| `pnpm web:lint` | 运行前端 ESLint |
| `pnpm web:preview` | 预览 Web 构建产物 |
| `pnpm web:build` | 类型检查并构建 Web |
| `pnpm web:typegen` | 根据 `apps/web/openapi.json` 生成前端 API 代码 |
| `pnpm web:openapi` | 先导出 OpenAPI，再生成前端 API 代码 |
| `pnpm server:dev` | 启动独立 Rust HTTP 服务 |
| `pnpm server:dev:cuda` | 启动独立服务并启用 CUDA feature |
| `pnpm server:build` | 编译独立 Rust HTTP 服务 |
| `pnpm desktop:dev` | 启动 Tauri 桌面端开发模式 |
| `pnpm desktop:dev:cuda` | 启动桌面端开发模式并启用 CUDA feature |
| `pnpm desktop:build` | 打包 Tauri 桌面端 |
| `pnpm desktop:build:cuda` | 打包桌面端并启用 CUDA feature |
| `pnpm openapi:export` | 从 Rust 导出 OpenAPI JSON |

## 配置项

服务启动时会读取仓库根目录 `.env`。常用环境变量如下：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `LISTEN` | 独立服务 `0.0.0.0:14200`，桌面端 `127.0.0.1:14200` | API 监听地址 |
| `RUST_LOG` | `info` | Rust 日志级别 |
| `APP_DATA_DIR` | `~/.media-admin/data` | 应用数据目录 |
| `APP_CONFIG_FILE` | `${APP_DATA_DIR}/app_config.json` | 本地应用配置 JSON |
| `SQLITE_DB_FILE` | `${APP_DATA_DIR}/media_admin.sqlite` | 业务 SQLite 数据库 |
| `TASKMILL_SQLITE` | `${APP_DATA_DIR}/taskmill.sqlite` | 任务调度 SQLite 数据库 |
| `MODELS_DIR` | `~/.media-admin/models` | Whisper 模型目录 |
| `DOWNLOAD_DIR` | `~/.media-admin/download` | 下载暂存目录 |
| `FFMPEG_DIR` | `~/.media-admin/tools/ffmpeg` | FFmpeg 安装目录 |
| `TEMP_WAV_DIR` | `~/.media-admin/temp/wav` | 临时 WAV 目录 |
| `TRANSCODE_CACHE_DIR` | `~/.media-admin/temp/transcode` | 视频转码缓存目录 |
| `SUBTITLE_CACHE_DIR` | `~/.media-admin/temp/subtitle` | 字幕缓存目录 |
| `TRANSCODE_GPU` | `auto` | 转码 GPU 策略，可选 `auto` / `nvenc` / `off` |
| `TRANSLATE_OPENAI_BASE` | 无 | 字幕翻译 OpenAI 兼容接口地址 |
| `TRANSLATE_OPENAI_API_KEY` | 无 | 字幕翻译 API Key |
| `TRANSLATE_OPENAI_DEFAULT_MODEL` | 无 | 字幕翻译默认模型 |
| `WHISPER_DECODE_CONCURRENCY` | 由代码默认值决定 | Whisper 解码并发 |
| `WHISPER_ENGINE_POOL_SIZE` | 由代码默认值决定 | Whisper 引擎池大小 |
| `WHISPER_ENGINE_CACHE_IDLE_SECS` | 由代码默认值决定 | Whisper 引擎空闲缓存时间 |
| `TASKMILL_MAX_CONCURRENCY` | `8` | 任务调度全局并发 |
| `TASKMILL_GROUP_SUBTITLE_PIPELINE` | `2` | 字幕流水线资源组并发 |
| `TASKMILL_GROUP_WHISPER` | `2` | Whisper 资源组并发 |
| `TASKMILL_GROUP_TRANSLATE` | `2` | 翻译资源组并发 |
| `TASKMILL_GROUP_SETUP_DOWNLOAD` | `1` | 设置页下载资源组并发 |
| `TASKMILL_GROUP_MEDIA_SCAN` | `1` | 媒体扫描资源组并发 |
| `SQLX_LOGGING` | debug 构建默认开启 | SQLx 查询日志开关 |
| `TAURI_WEB_URL` | `http://127.0.0.1:5173/` | 桌面端开发模式 Web 页面地址 |

示例：

```env
RUST_LOG=info
LISTEN=127.0.0.1:14200
APP_DATA_DIR=D:\media-admin-data
TRANSCODE_GPU=auto
```

## API 类型生成

前端 API 代码由 Rust OpenAPI 导出后通过 Orval 生成：

```bash
pnpm web:openapi
```

该命令会依次执行：

1. `pnpm openapi:export`：生成 `apps/web/openapi.json`
2. `pnpm web:typegen`：生成 `apps/web/src/api/generated.ts` 与 `apps/web/src/api/generated.schemas.ts`

不要手动修改以下生成文件：

- `apps/web/src/api/generated.ts`
- `apps/web/src/api/generated.schemas.ts`

## 开发约定

- 前端文件名使用中横线格式。
- 通用基础组件放在 `apps/web/src/components`。
- 业务组件放在 `apps/web/src/features`，按模块拆分目录。
- 前端 UI 优先基于 `@heroui/react` 与 `@heroui-pro/react`。
- 样式优先使用 Tailwind CSS，并注意主题兼容。
- 对接 Rust 服务 API 时，类型应从 OpenAPI/Orval 生成结果中引用。
- Rust 类型命名避免使用 `Model`、`Entity`、`Column` 结尾。
- 新增 Rust 结构体和方法时补充必要注释。

## 提交前检查

至少运行：

```bash
pnpm web:lint
cargo check
```

涉及 API 契约变更时，先运行：

```bash
pnpm web:openapi
pnpm web:lint
cargo check
```
