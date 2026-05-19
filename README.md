# 字幕管理工具

## 技术栈

### 后台

语言: `rust`
数据库: `sqlite`
所用库: `axum`

### 前端

语言: `typescript`
所用库: `react` `tanstack-router` `tanstack-query` `tailwindcss` `antd` `@antd/pro-components`

## 功能

- 网络字幕下载
- 本地模型生成字幕
- 本地视频播放

## 开发插件

[CUDA Toolkit 下载](https://developer.nvidia.com/cuda-downloads)

## 项目命令

在仓库根目录执行（需先 `pnpm install`）。后端依赖 `.env` 等配置，见项目内说明。

### 开发

| 命令                    | 描述                                                |
| ----------------------- | --------------------------------------------------- |
| `pnpm dev:web`          | 仅启动前端 Vite 开发服务（`http://localhost:5173`） |
| `pnpm dev:server`       | 启动 Rust HTTP 服务（`media-admin-server`）         |
| `pnpm dev:server:cuda`  | 同上，启用 CUDA feature（本地 GPU 推理等）          |
| `pnpm dev:desktop`      | 启动 Tauri 桌面端（含前端 + 内嵌服务）              |
| `pnpm dev:desktop:cuda` | 桌面端开发，启用 CUDA feature                       |

### 构建

| 命令                      | 描述                          |
| ------------------------- | ----------------------------- |
| `pnpm build:web`          | 构建前端静态资源到 `dist/`    |
| `pnpm build:server`       | 编译 Rust 服务端可执行文件    |
| `pnpm build:desktop`      | 打包 Tauri 桌面安装包         |
| `pnpm build:desktop:cuda` | 桌面端打包，启用 CUDA feature |

### 其它

| 命令             | 描述                                                         |
| ---------------- | ------------------------------------------------------------ |
| `pnpm lint`      | 前端 ESLint 检查                                             |
| `pnpm preview`   | 预览已构建的前端产物                                         |
| `pnpm typeshare` | 从 Rust 类型生成 `apps/web/src/types/api.ts`（勿手改该文件） |
