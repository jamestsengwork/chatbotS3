<script setup>
import { ref, nextTick, useTemplateRef } from 'vue'

// 同源部署 (Pages Functions) 時 VITE_API_BASE_URL 留空即可。
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
const HISTORY_LIMIT = 10 // 送往後端的最大歷史輪數

const messages = ref([
  {
    role: 'assistant',
    content:
      '您好，我是「術後安心助手」。我可以協助您了解一般術後照護的衛教資訊，例如傷口照護、用藥提醒、飲食建議等。請描述您目前的狀況。\n\n⚠️ 提醒：我無法進行診斷，若出現緊急症狀請立即就醫或撥打 119。',
    safetyLevel: 'normal'
  }
])
const input = ref('')
const loading = ref(false)
const errorMsg = ref('')
const listEl = useTemplateRef('listEl')

async function scrollToBottom() {
  await nextTick()
  if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight
}

// 取最近 N 則「真正對話內容」(排除歡迎詞與緊急 SOP) 給後端，避免 prompt 污染
function buildHistory() {
  return messages.value
    .filter((m) => m.safetyLevel !== 'emergency')
    .slice(-HISTORY_LIMIT * 2)
    .map((m) => ({ role: m.role, content: m.content }))
}

async function sendMessage() {
  const text = input.value.trim()
  if (!text || loading.value) return

  errorMsg.value = ''
  const history = buildHistory()
  messages.value.push({ role: 'user', content: text })
  input.value = ''
  loading.value = true
  await scrollToBottom()

  try {
    const res = await fetch(`${API_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, history })
    })

    if (res.status === 429) {
      throw new Error('您的提問過於頻繁，請稍候再試。')
    }
    if (!res.ok) {
      throw new Error(`伺服器回應錯誤 (${res.status})`)
    }

    const data = await res.json()
    messages.value.push({
      role: 'assistant',
      content: data.reply ?? '（沒有取得回覆內容）',
      safetyLevel: data.safetyLevel ?? 'normal'
    })
  } catch (err) {
    errorMsg.value = err.message || '無法連線至伺服器'
    messages.value.push({
      role: 'assistant',
      content: '抱歉，目前無法取得回覆，請稍後再試。若情況緊急請立即撥打 119 或前往急診。',
      safetyLevel: 'normal'
    })
  } finally {
    loading.value = false
    await scrollToBottom()
  }
}

function handleKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}
</script>

<template>
  <div class="app">
    <header class="header">
      <h1>術後安心助手</h1>
      <p class="subtitle">提供一般術後衛教資訊・無法取代醫療診斷</p>
    </header>

    <main class="chat-list" ref="listEl">
      <div
        v-for="(msg, idx) in messages"
        :key="idx"
        class="msg"
        :class="[
          msg.role === 'user' ? 'msg--user' : 'msg--bot',
          msg.safetyLevel === 'emergency' ? 'msg--emergency' : ''
        ]"
      >
        <div v-if="msg.safetyLevel === 'emergency'" class="emergency-badge">
          ⚠ 緊急警示
        </div>
        <div class="msg__content">{{ msg.content }}</div>
      </div>

      <div v-if="loading" class="msg msg--bot loading">
        <span class="dot"></span><span class="dot"></span><span class="dot"></span>
      </div>
    </main>

    <footer class="composer">
      <p v-if="errorMsg" class="error">{{ errorMsg }}</p>
      <div class="composer__row">
        <textarea
          v-model="input"
          placeholder="請描述您的術後狀況...（Shift+Enter 換行，Enter 送出）"
          rows="3"
          :disabled="loading"
          @keydown="handleKeydown"
        ></textarea>
        <button :disabled="loading || !input.trim()" @click="sendMessage">
          {{ loading ? '傳送中…' : '送出' }}
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.app {
  max-width: 720px;
  margin: 0 auto;
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  box-shadow: 0 0 24px rgba(0, 0, 0, 0.06);
}

.header {
  padding: 16px 20px;
  border-bottom: 1px solid #e5e9f0;
  background: linear-gradient(135deg, #4a90e2, #5fa8d3);
  color: #fff;
}

.header h1 {
  margin: 0;
  font-size: 20px;
}

.subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  opacity: 0.9;
}

.chat-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.msg {
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.55;
  font-size: 15px;
}

.msg--user {
  align-self: flex-end;
  background: #4a90e2;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.msg--bot {
  align-self: flex-start;
  background: #f0f3f8;
  color: #1f2933;
  border-bottom-left-radius: 4px;
}

.msg--emergency {
  background: #ffe5e5;
  color: #8b0000;
  border: 2px solid #d9534f;
  box-shadow: 0 0 0 4px rgba(217, 83, 79, 0.15);
}

.emergency-badge {
  display: inline-block;
  background: #d9534f;
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 999px;
  margin-bottom: 6px;
  letter-spacing: 1px;
}

.loading {
  display: flex;
  gap: 6px;
  align-items: center;
}

.dot {
  width: 8px;
  height: 8px;
  background: #94a3b8;
  border-radius: 50%;
  animation: blink 1.2s infinite ease-in-out;
}
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes blink {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}

.composer {
  border-top: 1px solid #e5e9f0;
  padding: 12px 16px;
  background: #fafbfc;
}

.composer__row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

textarea {
  flex: 1;
  resize: vertical;
  padding: 10px 12px;
  border: 1px solid #cbd2d9;
  border-radius: 8px;
  font-family: inherit;
  font-size: 15px;
  outline: none;
}

textarea:focus {
  border-color: #4a90e2;
  box-shadow: 0 0 0 3px rgba(74, 144, 226, 0.2);
}

button {
  padding: 10px 20px;
  background: #4a90e2;
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s;
}

button:hover:not(:disabled) {
  background: #3a7bc8;
}

button:disabled {
  background: #b0bec5;
  cursor: not-allowed;
}

.error {
  margin: 0 0 8px;
  color: #d9534f;
  font-size: 13px;
}
</style>
