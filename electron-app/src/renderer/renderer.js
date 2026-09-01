const ring = document.getElementById('ring');
const statusText = document.getElementById('status-text');
const conversation = document.getElementById('conversation');
const form = document.getElementById('command-form');
const input = document.getElementById('command-input');
const historyList = document.getElementById('history-list');

const STATE_LABEL = {
  idle: '대기 중',
  listening: '입력 처리 중',
  response: '응답 완료',
  error: '오류 발생',
};

let idleTimer = null;

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
    li.innerHTML = `
      <div class="h-title">${escapeHtml(task.title)}</div>
      <div class="h-meta">${task.status} · ${new Date(task.created_at).toLocaleString('ko-KR')}</div>
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
    const result = await window.caelus.sendCommand(text);
    addBubble('assistant', result.text);
  } catch (err) {
    addBubble('error', err.message || String(err));
  } finally {
    loadHistory();
  }
});

setState('idle');
loadHistory();
