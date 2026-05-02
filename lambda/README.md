# Lambda 後端代理（方案 B）

這個資料夾是 chatbotS3 的後端 API 代理，部署在 AWS Lambda（Node.js 20.x），
讓前端不需要把 `GEMINI_API_KEY` 暴露在瀏覽器。

```
S3/CloudFront (Vue 前端)
    │  POST /api/chat  { message, history }
    ▼
Lambda Function URL (本資料夾)
    │  讀取 process.env.GEMINI_API_KEY
    ▼
Google Gemini API
```

## 檔案
- [index.mjs](index.mjs)：Lambda handler（Node.js 20.x 內建 `fetch`，無外部相依）
- [package.json](package.json)：僅標示 `"type": "module"` 與 Node 版本

## 部署步驟（AWS CLI 版）

### 1. 打包

```powershell
cd lambda
Compress-Archive -Path index.mjs, package.json -DestinationPath function.zip -Force
```

### 2. 建立 IAM 角色（一次性）

```powershell
$ROLE_NAME = "chatbotS3-lambda-role"

# 信任政策
@'
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": "sts:AssumeRole"
  }]
}
'@ | Out-File -Encoding ascii trust.json

aws iam create-role --role-name $ROLE_NAME --assume-role-policy-document file://trust.json
aws iam attach-role-policy --role-name $ROLE_NAME `
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
```

### 3. 建立 Lambda Function

```powershell
$FN = "chatbotS3-api"
$REGION = "ap-northeast-1"
$ACCOUNT = (aws sts get-caller-identity --query Account --output text)
$ROLE_ARN = "arn:aws:iam::${ACCOUNT}:role/${ROLE_NAME}"

aws lambda create-function `
  --function-name $FN `
  --runtime nodejs20.x `
  --role $ROLE_ARN `
  --handler index.handler `
  --zip-file fileb://function.zip `
  --timeout 30 `
  --memory-size 256 `
  --region $REGION
```

### 4. 設定環境變數（GEMINI_API_KEY）

```powershell
aws lambda update-function-configuration `
  --function-name $FN `
  --environment "Variables={GEMINI_API_KEY=你的金鑰,ALLOWED_ORIGIN=https://你的網域}" `
  --region $REGION
```

> 進階建議：改用 **AWS Secrets Manager** 儲存金鑰，由 Lambda 在 cold start 時讀出，
> 不要直接寫成 plaintext 環境變數。

### 5. 啟用 Function URL（取得對外端點）

```powershell
aws lambda create-function-url-config `
  --function-name $FN `
  --auth-type NONE `
  --cors '{\"AllowOrigins\":[\"https://你的cloudfront網域\"],\"AllowMethods\":[\"POST\"],\"AllowHeaders\":[\"content-type\"],\"MaxAge\":86400}' `
  --region $REGION

# 取得 URL
aws lambda get-function-url-config --function-name $FN --region $REGION --query FunctionUrl --output text
```

把這個 URL 填到專案根目錄的 `.env`：

```env
VITE_API_BASE_URL=https://abcd1234.lambda-url.ap-northeast-1.on.aws
VITE_GEMINI_API_KEY=
```

然後重新 `npm run build && npm run deploy:s3`。

### 6. 後續更新程式碼

```powershell
cd lambda
Compress-Archive -Path index.mjs, package.json -DestinationPath function.zip -Force
aws lambda update-function-code --function-name chatbotS3-api --zip-file fileb://function.zip --region ap-northeast-1
```

## 本地測試

Node 18+：
```powershell
node -e "import('./index.mjs').then(m => m.handler({requestContext:{http:{method:'POST',path:'/api/chat'}},body:JSON.stringify({message:'傷口有點紅腫正常嗎？'})}).then(r => console.log(r.body)))"
```
記得先 `$env:GEMINI_API_KEY="..."`。

## 安全建議

- Function URL `AllowOrigins` 設成精確網域，不要用 `*`
- 加上 **AWS WAF** 限制 rate（每 IP 每分鐘 N 次）取代原本的 Cloudflare Rate Limiter
- 金鑰建議用 Secrets Manager / Parameter Store，並開啟 CloudWatch 用量告警
- Lambda 建議設 **Reserved concurrency** 上限，避免被刷爆費用
