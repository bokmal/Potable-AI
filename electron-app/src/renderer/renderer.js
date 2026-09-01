const ring = document.getElementById('ring');
const statusText = document.getElementById('status-text');
const conversation = document.getElementById('conversation');
const form = document.getElementById('command-form');
const input = document.getElementById('command-input');
const historyList = document.getElementById('history-list');
const modeButtons = document.querySelectorAll('.mode-btn');

const STATE_LABEL = {
  idle: '대기 중',
  listening: '입력 처리 중',
  response: '응답 완료',
  error: '오류 발생',
};

const MODE_LABEL = {
  chat: '대화',
  code: '코딩',
};

let idleTimer = null;

// 마지막으로 고른 모드를 기억해둔다(이 창 다음에 다시 켤 때 편의용).
let currentMode = 'chat';
try {
  const saved = localStorage.getItem('caelus-mode');
  if (saved === 'chat' || saved === 'code') currentMode = saved;
} catch {
  // localStorage 접근이 막힌 환경이면 기본값(chat)으로 계속 진행한다.
}

function setMode(mode) {
  currentMode = mode;
  modeButtons.forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  try {
    localStorage.setItem('caelus-mode', mode);
  } catch {
    // 저장 실패해도 이번 세션 동작에는 지장 없음.
  }
}

modeButtons.forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});
setMode(currentMode);

function setState(state) {
  ring.className = `jarvis-ring ${state}`;
  statusText.textContent = STATE_LABEL[state] || state;
}

function addBubble(role, text) {
  const el = document.createElement('div');
  el.className = `bubble ${role}`;
  el.textContent = text;
  conversation.appendChild(el);
  conversation.scrollTop = conversation.scrollHeight;
  return el;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadHistory() {
  const tasks = await window.caelus.getHistory();
  historyList.innerHTML = '';
  tasks.forEach((task) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    const modeLabel = MODE_LABEL[task.mode] || task.mode || '';
    li.innerHTML = `
      <div class="h-title">${escapeHtml(task.title)}</div>
      <div class="h-meta">${modeLabel} · ${task.status} · ${new Date(task.created_at).toLocaleString('ko-KR')}</div>
    `;
    historyList.appendChild(li);
  });
}

window.caelus.onStatus(({ state }) => {
  clearTimeout(idleTimer);
  setState(state);
  if (state === 'response' || state === 'error') {
    idleTimer = setTimeout(() => setState('idle'), 4000);
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  addBubble('user', text);
  input.value = '';

  try {
    const result = await window.caelus.sendCommand(text, currentMode);
    addBubble('assistant', result.text);
  } catch (err) {
    addBubble('error', err.message || String(err));
  } finally {
    loadHistory();
  }
});

setState('idle');
loadHistory();
