import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 開發時把 /api 轉發到 wrangler pages dev (預設 8788)
// 推薦做法：另開一個終端執行 `npx wrangler pages dev --proxy 5173 -- vite`
// 它會同時啟動 Vite (5173) 與 Functions runtime (8788)，並讓前後端共用 8788 同源。
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true
      }
    }
  }
})
