# 術後安心助手

> Vue 3 + Cloudflare Pages + Cloudflare Pages Functions + Gemini API 的術後護理 chatbot。

## 架構

```
使用者
  ↓
Cloudflare Pages（Vue 前端）
  ↓ POST /api/chat (同源)
Cloudflare Pages Functions（functions/api/chat.js）
  ↓
安全護欄判斷
  ├─ 命中緊急關鍵字 → 直接回覆急診 SOP
  └─ 否則
       ↓
     Google Gemini API（gemini-1.5-flash）
       ↓
回傳護理衛教回答
```

- **單一專案**：前端與 API 同源部署於 Cloudflare Pages，不需要 CORS。
- **安全護欄**：緊急關鍵字攔截、輸入長度限制、Cloudflare Rate Limiting（20 req / 60s / IP）。
- **Prompt**：以「極度耐心且專業的術後護理師」角色，明確區分正常紅腫與感染徵兆，**不做診斷、不開藥**。

## 專案結構

```
chatbot/
├── index.html
├── package.json
├── vite.config.js
├── wrangler.toml              # Pages 設定（含 Rate Limiter binding）
├── .env.example               # 前端環境變數
├── .dev.vars.example          # 後端本機 secret
├── public/
│   └── _headers               # 安全標頭
├── src/                       # Vue 前端
│   ├── App.vue
│   ├── main.js
│   └── style.css
└── functions/
    └── api/
        └── chat.js            # POST /api/chat
```

## 本機開發

```powershell
npm install

# 後端 secret
Copy-Item .dev.vars.example .dev.vars
# 編輯 .dev.vars，填入 GEMINI_API_KEY

# 前端環境變數（同源部署可留空）
Copy-Item .env.example .env

# 啟動：Vite + Pages Functions 同時跑
npm run dev:pages
# 開啟 http://localhost:8788
```

## 部署到 Cloudflare Pages

```powershell
# 1. 第一次設定 Secret
npx wrangler login
npx wrangler pages secret put GEMINI_API_KEY --project-name post-op-care-bot

# 2. 建置並部署
npm run deploy
```

或在 Cloudflare Dashboard 連結 Git Repo，設定：
- Build command：`npm run build`
- Build output directory：`dist`
- Environment variables：`GEMINI_API_KEY`（設為 Secret / encrypted）

## API 規格

### `POST /api/chat`

Request：
```json
{
  "message": "我的傷口有點紅腫，正常嗎？",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

Response：
```json
{
  "reply": "...",
  "safetyLevel": "normal"
}
```

| 欄位 | 說明 |
|---|---|
| `safetyLevel` | `"normal"` / `"emergency"`；前端遇到 `emergency` 會以紅色警示樣式呈現。 |

### 緊急關鍵字（直接回 SOP，不呼叫 Gemini）

`大量出血`、`發燒`、`劇烈疼痛`、`呼吸困難`、`意識不清`、`胸痛`、`傷口裂開`、`血便`、`嘔血`、`抽搐`、`視力模糊`

### 錯誤碼

| HTTP | 情境 |
|---|---|
| 400 | message 缺漏／過長／格式錯誤 |
| 429 | 觸發 Rate Limiter |
| 500 | 未設定 `GEMINI_API_KEY` |
| 502 | Gemini 上游錯誤 |

## 安全與免責

- 本系統**僅提供一般衛教資訊，不可作為診斷依據**。
- 已在 Prompt 嚴格禁止 AI 進行診斷、處方、用藥劑量建議。
- `_headers` 已套用 CSP、X-Frame-Options 等基本安全標頭。
- 緊急狀況請立即撥打 119 或前往急診。
