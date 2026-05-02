/**
 * 術後安心助手 - 前端 Chat 模組（S3 靜態版本）
 *
 * 透過 AWS Lambda 代理呼叫 Gemini，API Key 由 Lambda 環境變數保管。
 * 前端只負責：
 *   - 緊急關鍵字本地攔截（節省一次 API 呼叫）
 *   - 呼叫 ${VITE_API_BASE_URL}/api/chat
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

function containsEmergencyKeyword(text) {
  return EMERGENCY_KEYWORDS.some((kw) => text.includes(kw));
}

async function callViaProxy(baseUrl, message, history) {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });
  if (res.status === 429) throw new Error('您的提問過於頻繁，請稍候再試。');
  if (!res.ok) throw new Error(`伺服器回應錯誤 (${res.status})`);
  const data = await res.json();
  return { reply: data.reply, safetyLevel: data.safetyLevel ?? 'normal' };
}

/**
 * 主要入口：透過 Lambda 代理取得 Gemini 回覆
 * @param {string} message
 * @param {{role:'user'|'assistant', content:string}[]} history
 * @returns {Promise<{reply:string, safetyLevel:'normal'|'emergency'}>}
 */
export async function sendChat(message, history) {
  const text = (message ?? '').trim();
  if (!text) throw new Error('message 不可為空');
  if (text.length > 2000) throw new Error('message 過長（上限 2000 字）');

  if (containsEmergencyKeyword(text)) {
    return { reply: EMERGENCY_SOP, safetyLevel: 'emergency' };
  }

  const apiBase = import.meta.env.VITE_API_BASE_URL;
  if (!apiBase) {
    throw new Error('未設定 VITE_API_BASE_URL，請於 .env 填入 Lambda Function URL');
  }
  return callViaProxy(apiBase, text, history);
}
