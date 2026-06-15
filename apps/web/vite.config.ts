import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
// 构建产物输出到仓库根目录 dist/，与 Axum ServeDir("dist")、从仓库根启动 cargo 的约定一致
export default defineConfig({
  build: {
    outDir: path.resolve(projectRoot, '../../dist'),
    emptyOutDir: true,
  },
  plugins: [tanstackRouter(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(projectRoot, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    watch: {
      ignored: (filePath: string) => {
        const rel = path.relative(projectRoot, filePath)
        if (!rel || rel.startsWith('..'))
          return false //  cwd 外的路径交给默认逻辑
        const norm = rel.replace(/\\/g, '/')
        // 不忽略 src 下的文件 → 会监听
        if (norm === 'src' || norm.startsWith('src/'))
          return false
        // 其余路径一律忽略（不监听）
        return true
      },
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4200',
        changeOrigin: true,
      },
    },
  },
})
