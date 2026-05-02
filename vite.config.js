import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// S3 靜態託管版本：純前端，不再需要 /api 代理
export default defineConfig({
  plugins: [vue()],
  // 部署到 S3 根網域時保持 './'，
  // 若部署在子路徑（例如 https://example.com/chatbot/），請改成 '/chatbot/'
  base: './',
  server: {
    port: 5173
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
