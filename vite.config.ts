import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      ignored: (filePath: string) => {
        const rel = path.relative(projectRoot, filePath)
        if (!rel || rel.startsWith('..')) return false //  cwd 外的路径交给默认逻辑
        const norm = rel.replace(/\\/g, '/')
        // 不忽略 src 下的文件 → 会监听
        if (norm === 'src' || norm.startsWith('src/')) return false
        // 其余路径一律忽略（不监听）
        return true
      },
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
})
