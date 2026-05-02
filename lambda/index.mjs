/**
 * AWS Lambda handler — POST /api/chat
 *
 * 部署：Node.js 20.x，環境變數 GEMINI_API_KEY=...
 * 觸發：Lambda Function URL (Auth: NONE, CORS 設你的 S3 / CloudFront 網域)
 *
 * 前端在 .env 設定 VITE_API_BASE_URL=<這個 Function URL>，
 * 會打 POST {VITE_API_BASE_URL}/api/chat。
 *
 * 邏輯與舊版 functions/api/chat.js 等價：
 *   - 緊急關鍵字攔截（不送 Gemini）
 *   - System prompt 護欄
 *   - 呼叫 Gemini API
 */

const EMERGENCY_KEYWORDS = [
  '大量出血',
  '發燒',
  '劇烈疼痛',
  '呼吸困難',
  '意識不清',
  '胸痛',
  '傷口裂開',
  '血便',
  '嘔血',
  '抽搐',
  '視力模糊',
];

const EMERGENCY_SOP = `⚠ 緊急狀況提醒 ⚠

您描述的症狀屬於需要立即處置的警訊，請務必依下列步驟處理，不要等待：

1. 立刻撥打 119 或請人協助送往最近的急診室。
2. 如有大量出血：以乾淨紗布或毛巾直接加壓止血，受傷部位高於心臟，避免自行移除原有敷料。
3. 如有高燒（≥ 38.5°C）：先補充水分、避免悶熱，盡速就醫。
4. 如有劇烈疼痛、胸痛、呼吸困難：保持半坐臥姿勢，鬆開緊身衣物，盡快就醫。
5. 如有意識不清、抽搐：將患者側躺避免哽嗆，記錄發作時間，立刻送醫。
6. 如有傷口裂開：以乾淨敷料覆蓋固定，不要嘗試自行縫合或塞回組織。
7. 攜帶您的手術紀錄、目前服用的藥物清單、以及主治醫師資訊。

我是衛教用 AI 助手，無法取代醫療人員的判斷。請立即聯繫專業醫護協助您，謝謝。`;

const SYSTEM_PROMPT = `你是一位「極度耐心且專業的術後護理師」，名字叫「術後安心助手」。請以繁體中文、溫柔且具體的口吻回覆使用者。

【你的職責】
- 提供一般性的術後衛教資訊（傷口照護、清潔、換藥原則、活動限制、飲食建議、用藥提醒、回診注意事項等）。
- 協助病人辨識「正常術後反應」與「需要回診/就醫的警訊」。

【正常紅腫 vs. 感染徵兆，請務必清楚區分】
- 正常術後反應（通常 3–5 天內逐漸改善）：
  • 傷口周圍輕微紅、輕微腫、些微熱感
  • 輕度痠痛、緊繃感，使用止痛藥可緩解
  • 少量淡血色或淡黃色滲液
  • 輕微瘀青
- 感染徵兆（建議盡速回診或就醫）：
  • 紅腫範圍逐日擴大，或有紅線往外延伸
  • 傷口持續發熱、按壓疼痛加劇
  • 出現膿狀（黃綠色、混濁）分泌物或惡臭
  • 體溫 ≥ 38°C、發冷、全身倦怠
  • 傷口裂開、縫線崩開、組織外露
  • 麻木、感覺異常、肢體蒼白冰冷

【嚴格規則】
1. 你不是醫師，不可做任何「診斷」、「判斷病因」或「開立處方/劑量」。
2. 不可建議使用未經醫師指示的藥物，也不要更改現有醫囑。
3. 回答時要先同理使用者，再提供條列式衛教重點，最後提醒「若症狀加重或不確定，請聯繫主治醫師或回診」。
4. 若使用者描述疑似緊急症狀（大量出血、高燒、劇烈疼痛、呼吸困難、意識不清、胸痛、傷口裂開、抽搐等），請立即建議撥打 119 或前往急診，不要嘗試替代醫療處置。
5. 回覆長度控制在 250 字內，使用清楚的條列。
6. 不要捏造醫學數據或引用不存在的研究。`;

const GEMINI_MODEL = 'gemini-2.5-flash-lite';

// 若 Lambda Function URL 已設 CORS，這些 header 仍保留作雙保險。
// 建議在 Function URL CORS 設定中將 AllowOrigins 改為精確網域。
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(data, status = 200) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS_HEADERS,
    },
    body: JSON.stringify(data),
  };
}

function containsEmergencyKeyword(text) {
  return EMERGENCY_KEYWORDS.some((kw) => text.includes(kw));
}

function buildContents(history, message) {
  const items = Array.isArray(history) ? history : [];
  const contents = [];
  for (const m of items) {
    if (!m || typeof m.content !== 'string') continue;
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content.slice(0, 2000) }],
    });
  }
  contents.push({ role: 'user', parts: [{ text: message }] });
  return contents;
}

async function callGemini(message, history, apiKey) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    systemInstruction: {
      role: 'system',
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: buildContents(history, message),
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 600,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API 錯誤 (${res.status}): ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const reply = data?.candidates?.[0]?.content?.parts
    ?.map((p) => p.text)
    .filter(Boolean)
    .join('\n')
    ?.trim();

  if (!reply) throw new Error('Gemini 沒有回傳有效內容');
  return reply;
}

/**
 * Lambda Function URL handler (payload format v2.0)
 * https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html
 */
export const handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod || 'POST';
  const path = event?.requestContext?.http?.path || event?.rawPath || '/';

  // CORS preflight
  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS, body: '' };
  }

  if (method !== 'POST') {
    return jsonResponse({ error: 'Method Not Allowed' }, 405);
  }

  // 路徑限制（可選）：只接受 /api/chat
  if (path && !path.endsWith('/api/chat') && path !== '/') {
    return jsonResponse({ error: 'Not Found' }, 404);
  }

  // 解析 body（Function URL 可能 base64 編碼）
  let raw = event.body ?? '';
  if (event.isBase64Encoded) {
    raw = Buffer.from(raw, 'base64').toString('utf-8');
  }
  let payload;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    return jsonResponse({ error: '請傳送有效的 JSON' }, 400);
  }

  const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
  if (!message) return jsonResponse({ error: 'message 不可為空' }, 400);
  if (message.length > 2000) return jsonResponse({ error: 'message 過長（上限 2000 字）' }, 400);

  if (containsEmergencyKeyword(message)) {
    return jsonResponse({ reply: EMERGENCY_SOP, safetyLevel: 'emergency' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return jsonResponse({ error: '伺服器尚未設定 GEMINI_API_KEY' }, 500);
  }

  try {
    const reply = await callGemini(message, payload?.history, apiKey);
    return jsonResponse({ reply, safetyLevel: 'normal' });
  } catch (err) {
    return jsonResponse(
      {
        error: '無法取得 AI 回覆',
        detail: err instanceof Error ? err.message : String(err),
      },
      502,
    );
  }
};
