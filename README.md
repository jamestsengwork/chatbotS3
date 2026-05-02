# 術後安心助手（S3 靜態部署版）

> Vue 3 + Vite 的術後護理 chatbot，部署於 **AWS S3**（建議搭配 CloudFront）。
> 由於 S3 只能託管靜態網站，原本在 Cloudflare Pages Functions 的 API 邏輯已搬到前端 [src/lib/chat.js](src/lib/chat.js)。

---

## 兩種 API Key 對接方式（重要）

S3 是純靜態託管，**沒有伺服器端可以保管 secret**，因此 Gemini API Key 只有兩條路：

### 方案 A：直連 Gemini（最簡單，但 Key 會外洩）

- 在 `.env` 設定 `VITE_GEMINI_API_KEY=xxx`
- `vite build` 會把它**寫死進 JS bundle**，任何造訪網站的人都能從 DevTools 看到
- **僅適用於：** 內部 demo、純個人用、或在 Google AI Studio 將該 Key 嚴格限制（HTTP referrer 白名單 + 用量上限 + 預算告警）
- **不適合公開生產環境**

```env
# .env
VITE_GEMINI_API_KEY=AIza...你的key
VITE_API_BASE_URL=
```

#### 防護建議（若一定要走方案 A）

1. 到 [Google Cloud Console → API & Services → Credentials](https://console.cloud.google.com/apis/credentials) 編輯該 Key：
   - **Application restrictions**：選 _HTTP referrers_，加入你的 S3 / CloudFront 網域，例如 `https://chatbot.example.com/*`
   - **API restrictions**：限制只允許 _Generative Language API_
2. 在 Google Cloud → Billing 設定**預算警示**，避免被刷爆。
3. 定期輪替 Key。

> 即使加了 referrer 限制，仍可被人偽造 referrer 直接呼叫，只是門檻提高。

### 方案 B：自己架 AWS Lambda 代理（推薦生產用）

讓 Lambda 保管 Key，前端只呼叫 Lambda：

```
瀏覽器 (S3/CloudFront)
    ↓ POST /api/chat
Lambda Function URL (或 API Gateway)
    ↓ 帶上環境變數 GEMINI_API_KEY
Google Gemini API
```

- 在 `.env` 改填 `VITE_API_BASE_URL`，**不要**填 `VITE_GEMINI_API_KEY`
- [src/lib/chat.js](src/lib/chat.js) 偵測到 `VITE_API_BASE_URL` 有值時會自動改走代理（呼叫 `${VITE_API_BASE_URL}/api/chat`）

```env
# .env
VITE_GEMINI_API_KEY=
VITE_API_BASE_URL=https://abcd1234.lambda-url.ap-northeast-1.on.aws
```

#### Lambda 建立步驟

1. 建立 Lambda Function（runtime: Node.js 20.x）
2. **Configuration → Environment variables** 加入 `GEMINI_API_KEY=你的金鑰`
3. 啟用 **Function URL**：Auth type 選 `NONE`，CORS 允許你的 S3 / CloudFront 網域、`POST` 方法、`content-type` header
4. 把原 `functions/api/chat.js`（已被刪除，但邏輯保留在 [src/lib/chat.js](src/lib/chat.js)）改寫為 Lambda handler，從 `process.env.GEMINI_API_KEY` 讀取金鑰
5. 路由：Function URL 預設根路徑就是 entry，前端會打 `${VITE_API_BASE_URL}/api/chat`，請在 handler 內判斷 `event.requestContext.http.path === '/api/chat'` 或直接忽略路徑

> 也可改用 **API Gateway + Lambda**、**AWS AppRunner**，或將 Key 放在 **AWS Secrets Manager** 由 Lambda 動態載入。

---

## 本機開發

```powershell
npm install

# 複製環境變數樣板，依「方案 A 或 B」填入
Copy-Item .env.example .env
notepad .env

npm run dev
# 開啟 http://localhost:5173
```

---

## 部署到 AWS S3

### 0. 前置：安裝並設定 AWS CLI

```powershell
aws configure   # 填入 Access Key / Secret / Region (例如 ap-northeast-1)
```

### 1. 建立 S3 Bucket（一次性）

```powershell
$BUCKET = "your-chatbot-bucket-name"
$REGION = "ap-northeast-1"

aws s3api create-bucket --bucket $BUCKET --region $REGION `
  --create-bucket-configuration LocationConstraint=$REGION

# 啟用靜態網站託管
aws s3 website s3://$BUCKET/ --index-document index.html --error-document index.html
```

### 2. 設定 Bucket Policy（公開讀取版本；搭配 CloudFront OAC 時改用私有）

新增 `bucket-policy.json`：

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadGetObject",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::your-chatbot-bucket-name/*"
  }]
}
```

```powershell
aws s3api put-public-access-block --bucket $BUCKET `
  --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicAcls=false"

aws s3api put-bucket-policy --bucket $BUCKET --policy file://bucket-policy.json
```

### 3. 建置並上傳

```powershell
$env:S3_BUCKET = "your-chatbot-bucket-name"
npm run deploy:s3
```

或手動：

```powershell
npm run build
aws s3 sync dist/ s3://your-chatbot-bucket-name/ --delete
```

S3 網站端點：`http://your-chatbot-bucket-name.s3-website-ap-northeast-1.amazonaws.com`

### 4.（建議）搭配 CloudFront 取得 HTTPS 與全球 CDN

1. 建立 CloudFront Distribution，Origin 指到 S3 bucket（建議用 **OAC**，bucket 設為私有）
2. Default root object：`index.html`
3. SPA fallback：在 _Custom error responses_ 將 `403`、`404` 對應回 `/index.html` 並回 200
4. 加上 **Response headers policy** 套用安全標頭（CSP / X-Frame-Options / Referrer-Policy）：
   - 方案 A：`connect-src 'self' https://generativelanguage.googleapis.com`
   - 方案 B：`connect-src 'self' https://你的lambda網域`

更新後失效快取：

```powershell
$env:CF_DIST_ID = "E1XXXXXXXXX"
npm run deploy:s3:invalidate
```

---

## 專案結構

```
chatbotS3/
├── index.html
├── package.json
├── vite.config.js
├── .env.example
├── public/
├── src/
│   ├── App.vue
│   ├── main.js
│   ├── style.css
│   └── lib/
│       └── chat.js          # 原 functions/api/chat.js 搬到前端
└── README.md
```

## 與舊版（Cloudflare Pages）的差異

| 項目 | 舊版 (Cloudflare Pages) | 新版 (AWS S3) |
| --- | --- | --- |
| 前端託管 | Cloudflare Pages | S3 (+ CloudFront) |
| API 路由 | Pages Functions `/api/chat` | 前端直連 Gemini **或** Lambda 代理 |
| Key 保管 | Pages Secret（伺服器） | 前端 build-time（A） / Lambda env（B） |
| Rate Limit | Cloudflare Rate Limiter binding | 由 Lambda / API Gateway / WAF 自行實作 |
| 安全標頭 | `public/_headers` | CloudFront Response Headers Policy |

## 安全與免責

- 本系統**僅提供一般衛教資訊，不可作為診斷依據**。
- Prompt 已嚴格禁止 AI 進行診斷、處方、用藥劑量建議。
- 緊急關鍵字會在前端攔截，直接回 SOP，不送 Gemini。
- **若採方案 A，請務必加上 Google API Key referrer 限制與用量預算告警**。
- 緊急狀況請立即撥打 119 或前往急診。
