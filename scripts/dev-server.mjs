/**
 * 本機開發代理 (Local dev proxy)
 *
 * 用途：在本機跑 Vite 時，模擬 AWS Lambda Function URL 行為。
 *      讓前端呼叫 /api/chat → 轉給 lambda/index.mjs 的 handler。
 *
 * 啟動：
 *   1. 在專案根目錄建立 .dev.vars（已被 .gitignore 排除），內容：
 *        GEMINI_API_KEY=你的金鑰
 *   2. 執行 `npm run dev`（會同時起 Vite 與這支 server）
 *
 * 預設埠號 8787，Vite proxy 會把 /api/* 轉到這裡。
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// 載入 .dev.vars 到 process.env
const devVarsPath = resolve(ROOT, '.dev.vars');
if (existsSync(devVarsPath)) {
  const txt = readFileSync(devVarsPath, 'utf-8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      process.env[m[1]] = v;
    }
  }
}

if (!process.env.GEMINI_API_KEY) {
  console.warn('[dev-server] 找不到 GEMINI_API_KEY，請在 .dev.vars 設定');
}

const { handler } = await import(resolve(ROOT, 'lambda/index.mjs'));

const PORT = Number(process.env.DEV_API_PORT || 8787);

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  // CORS（本機 5173 → 8787）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const body = req.method === 'POST' ? await readBody(req) : '';

  // 構造 Lambda Function URL v2.0 event
  const event = {
    requestContext: { http: { method: req.method, path: req.url } },
    rawPath: req.url,
    headers: req.headers,
    body,
    isBase64Encoded: false,
  };

  try {
    const result = await handler(event);
    res.statusCode = result.statusCode || 200;
    for (const [k, v] of Object.entries(result.headers || {})) res.setHeader(k, v);
    res.end(result.body || '');
  } catch (err) {
    console.error('[dev-server] handler error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'dev server error', detail: String(err) }));
  }
});

server.listen(PORT, () => {
  console.log(`[dev-server] Lambda emulator listening on http://localhost:${PORT}`);
});
