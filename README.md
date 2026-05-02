# 術後安心助手（S3 + Lambda 版）

> Vue 3 + Vite 的術後護理 chatbot。
> 前端託管於 **AWS S3**（建議搭配 CloudFront），後端 Gemini API 代理由 **AWS Lambda Function URL** 提供。
> Gemini API Key 僅存放於 Lambda 環境變數，**不會出現在前端、git、瀏覽器**。

## 架構

```
使用者
  ↓
S3 / CloudFront（Vue 前端）
  ↓ POST /api/chat
AWS Lambda Function URL（lambda/index.mjs）
  ↓ 帶上 process.env.GEMINI_API_KEY
Google Gemini API
```

- 前端 [src/lib/chat.js](src/lib/chat.js) 會在本機先做緊急關鍵字攔截，命中時直接回 SOP，不送 Lambda。
- 其餘訊息送到 `${VITE_API_BASE_URL}/api/chat`，由 Lambda 加上 system prompt、安全護欄後呼叫 Gemini。

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
│   └── lib/chat.js          # 前端 chat 模組（呼叫 Lambda）
├── lambda/
│   ├── index.mjs            # Lambda handler
│   ├── package.json
│   └── README.md            # Lambda 部署步驟
└── README.md
```

---

## 部署順序總覽

1. 先部署 **Lambda**，取得 Function URL（[lambda/README.md](lambda/README.md)）
2. 把 Function URL 寫入專案根目錄 `.env`
3. `npm run build && npm run deploy:s3` 上傳前端到 S3
4. （建議）前面套 CloudFront 取得 HTTPS / 全球 CDN

---

## 1. 部署 Lambda（API Key 在這一步輸入）

詳細步驟見 [lambda/README.md](lambda/README.md)，重點：

```powershell
cd lambda
Compress-Archive -Path index.mjs, package.json -DestinationPath function.zip -Force
# 建立 IAM Role、create-function、create-function-url-config…

# 在這一步輸入 API Key（之後可改）
aws lambda update-function-configuration `
  --function-name chatbotS3-api `
  --environment "Variables={GEMINI_API_KEY=AIza你的金鑰,ALLOWED_ORIGIN=https://你的網域}" `
  --region ap-northeast-1
```

完成後從 Console 或 CLI 複製 Function URL，例如：
`https://abcd1234.lambda-url.ap-northeast-1.on.aws`

---

## 2. 設定前端 `.env`

```powershell
cd D:\Program\chatbotS3
Copy-Item .env.example .env
notepad .env
```

填入：
```env
VITE_API_BASE_URL=https://abcd1234.lambda-url.ap-northeast-1.on.aws
```

---

## 3. 本機開發

```powershell
npm install
npm run dev
# 開啟 http://localhost:5173
```

---

## 4. 部署到 AWS S3

### 0. 前置：安裝並設定 AWS CLI

```powershell
aws configure   # Access Key / Secret / Region (例如 ap-northeast-1)
```

### 1. 建立 S3 Bucket（一次性）

```powershell
$BUCKET = "your-chatbot-bucket-name"
$REGION = "ap-northeast-1"

aws s3api create-bucket --bucket $BUCKET --region $REGION `
  --create-bucket-configuration LocationConstraint=$REGION

aws s3 website s3://$BUCKET/ --index-document index.html --error-document index.html
```

### 2. 設定 Bucket Policy（公開讀取版本）

`bucket-policy.json`：

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

> 搭配 CloudFront OAC 時請改用私有 bucket，並由 OAC 控管存取。

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

### 4.（建議）搭配 CloudFront

1. 建立 CloudFront Distribution，Origin 指到 S3 bucket（建議用 OAC，bucket 設為私有）
2. Default root object：`index.html`
3. SPA fallback：在 _Custom error responses_ 將 `403`、`404` 對應回 `/index.html` 200
4. 加 **Response headers policy** 套用安全標頭，CSP 的 `connect-src` 需允許 Lambda 網域：
   `connect-src 'self' https://你的lambda網域`

更新後失效快取：
```powershell
$env:CF_DIST_ID = "E1XXXXXXXXX"
npm run deploy:s3:invalidate
```

---

## API Key 管理

| 問題 | 答案 |
| --- | --- |
| Key 放在哪？ | AWS Lambda 環境變數 `GEMINI_API_KEY` |
| 前端 `.env` 要不要放 Key？ | **不要**，只放 `VITE_API_BASE_URL` |
| 換 Key 要重新 build 前端嗎？ | **不用**，只更新 Lambda 環境變數即可 |
| Key 會被人從瀏覽器看到嗎？ | 不會，前端只會看到 Lambda Function URL |

進階：將 Key 改放 **AWS Secrets Manager** 或 **SSM Parameter Store**，由 Lambda 在啟動時讀出，避免 plaintext 環境變數。

## 安全與免責

- 本系統**僅提供一般衛教資訊，不可作為診斷依據**。
- Prompt 已嚴格禁止 AI 進行診斷、處方、用藥劑量建議。
- 緊急關鍵字會在前端攔截，直接回 SOP，不送 Gemini。
- 建議搭配 **AWS WAF** 做 rate limiting，避免 Lambda 被惡意刷費。
- 緊急狀況請立即撥打 119 或前往急診。
