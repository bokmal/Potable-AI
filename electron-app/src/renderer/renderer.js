// --- DOM 참조 ---
const ring = document.getElementById('ring');
const statusText = document.getElementById('status-text');
const conversation = document.getElementById('conversation');
const form = document.getElementById('command-form');
const input = document.getElementById('command-input');
const submitBtn = form.querySelector('.command-submit');
const cancelBtn = document.getElementById('cancel-btn');
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const historySearch = document.getElementById('history-search');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const modeButtons = document.querySelectorAll('.mode-btn');
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const themeToggle = document.getElementById('theme-toggle');
const themeToggleLabel = document.getElementById('theme-toggle-label');
const projectSelect = document.getElementById('project-select');
const newProjectBtn = document.getElementById('new-project-btn');
const exportBtn = document.getElementById('export-btn');
const checkUpdateBtn = document.getElementById('check-update-btn');
const updateStatus = document.getElementById('update-status');
const usageLinkBtn = document.getElementById('usage-link-btn');

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
let isBusy = false;
let viewingTaskId = null; // 사이드바에서 클릭해 다시 보고 있는 과거 작업(있으면)
let pendingTaskId = null; // 지금 진행 중인 요청의 taskId
let pendingBubble = null; // 그 요청의 스트리밍 대상 말풍선 { el, contentEl }
let streamedText = '';
let allTasksCache = [];

// ===================================================================
// 테마 (다크 / 라이트)
// ===================================================================
let currentTheme = 'dark';
try {
  const saved = localStorage.getItem('caelus-theme');
  if (saved === 'light' || saved === 'dark') currentTheme = saved;
} catch {
  // localStorage 접근 불가 환경이면 기본값(dark)으로 진행
}

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleLabel.textContent = theme === 'light' ? '라이트 ☀' : '다크 ☾';
  try {
    localStorage.setItem('caelus-theme', theme);
  } catch {
    // 저장 실패해도 이번 세션 표시에는 지장 없음
  }
}
applyTheme(currentTheme);
themeToggle.addEventListener('click', () => applyTheme(currentTheme === 'light' ? 'dark' : 'light'));

// ===================================================================
// 설정 패널 (톱니바퀴 아이콘으로 여닫음)
// ===================================================================
settingsToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  settingsPanel.hidden = !settingsPanel.hidden;
});
document.addEventListener('click', (event) => {
  if (!settingsPanel.hidden && !settingsPanel.contains(event.target) && event.target !== settingsToggle) {
    settingsPanel.hidden = true;
  }
});

// ===================================================================
// 응답 모드 (대화 / 코딩)
// ===================================================================
let currentMode = 'chat';
try {
  const savedMode = localStorage.getItem('caelus-mode');
  if (savedMode === 'chat' || savedMode === 'code') currentMode = savedMode;
} catch {
  // localStorage 접근 불가 환경이면 기본값(chat)으로 진행
}

function setMode(mode) {
  currentMode = mode;
  modeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
  try {
    localStorage.setItem('caelus-mode', mode);
  } catch {
    // 저장 실패해도 이번 세션 동작에는 지장 없음
  }
}
modeButtons.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.mode)));
setMode(currentMode);

// ===================================================================
// 상태 인디케이터 + 알림음
// ===================================================================
function setState(state) {
  ring.className = `jarvis-ring ${state}`;
  statusText.textContent = STATE_LABEL[state] || state;
}

function playBeep(kind) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = kind === 'error' ? 220 : 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // 오디오 재생이 막힌 환경이면 조용히 무시(치명적이지 않음)
  }
}

// ===================================================================
// 말풍선 렌더링 (경량 마크다운: 코드 펜스 / 인라인 코드만 지원)
// ===================================================================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderMarkdownLite(text) {
  const parts = [];
  const fenceRegex = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;
  while ((match = fenceRegex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    parts.push({ type: 'code', content: match[2] });
    lastIndex = fenceRegex.lastIndex;
  }
  if (lastIndex < text.length) parts.push({ type: 'text', content: text.slice(lastIndex) });

  return parts
    .map((part) => {
      if (part.type === 'code') {
        return `<pre><code>${escapeHtml(part.content)}</code></pre>`;
      }
      return escapeHtml(part.content).replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);
    })
    .join('');
}

function setBubbleContent(contentEl, role, text) {
  contentEl.dataset.raw = text;
  if (role === 'assistant') {
    contentEl.innerHTML = renderMarkdownLite(text);
  } else {
    contentEl.textContent = text;
  }
}

function addBubble(role, text) {
  const el = document.createElement('div');
  el.className = `bubble ${role}`;

  const contentEl = document.createElement('div');
  contentEl.className = 'bubble-content';
  setBubbleContent(contentEl, role, text);
  el.appendChild(contentEl);

  if (role !== 'user') {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'bubble-copy';
    copyBtn.textContent = '복사';
    copyBtn.addEventListener('click', async () => {
      await window.caelus.copyText(contentEl.dataset.raw || '');
      copyBtn.textContent = '복사됨';
      setTimeout(() => {
        copyBtn.textContent = '복사';
      }, 1500);
    });
    el.appendChild(copyBtn);
  }

  conversation.appendChild(el);
  conversation.classList.add('has-messages');
  conversation.scrollTop = conversation.scrollHeight;
  return { el, contentEl };
}

function clearConversation() {
  // #conversation-empty(빈 상태 안내)는 그대로 두고 말풍선만 지운다.
  conversation.querySelectorAll('.bubble').forEach((el) => el.remove());
  conversation.classList.remove('has-messages');
}

// ===================================================================
// 작업 기록(사이드바) — 조회 / 검색 / 클릭해서 다시 보기 / 삭제 / 전체 삭제
// ===================================================================
async function loadHistory() {
  allTasksCache = await window.caelus.getHistory();
  renderHistoryList();
}

function renderHistoryActiveState() {
  historyList.querySelectorAll('.history-item').forEach((li) => {
    li.classList.toggle('active', li.dataset.taskId === viewingTaskId);
  });
}

function renderHistoryList() {
  const query = historySearch.value.trim().toLowerCase();
  const filtered = query
    ? allTasksCache.filter((t) => t.title.toLowerCase().includes(query))
    : allTasksCache;

  historyList.innerHTML = '';
  historyEmpty.hidden = filtered.length > 0;
  filtered.forEach((task) => {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.dataset.taskId = task.task_id;
    const modeLabel = MODE_LABEL[task.mode] || task.mode || '';
    li.innerHTML = `
      <div class="h-title">${escapeHtml(task.title)}</div>
      <div class="h-meta">${modeLabel} · ${task.status} · ${new Date(task.created_at).toLocaleString('ko-KR')}</div>
      <button type="button" class="h-delete" title="삭제">&#10005;</button>
    `;
    li.addEventListener('click', (event) => {
      if (event.target.closest('.h-delete')) return;
      viewTask(task.task_id);
    });
    li.querySelector('.h-delete').addEventListener('click', async (event) => {
      event.stopPropagation();
      if (!confirm('이 기록을 삭제할까요?')) return;
      await window.caelus.deleteTask(task.task_id);
      if (viewingTaskId === task.task_id) {
        clearConversation();
        viewingTaskId = null;
      }
      loadHistory();
    });
    historyList.appendChild(li);
  });

  renderHistoryActiveState();
}

async function viewTask(taskId) {
  if (isBusy) return; // 진행 중인 요청이 있으면 화면을 안 바꾼다(혼란 방지)
  const task = await window.caelus.getTask(taskId);
  if (!task) return;

  clearConversation();
  addBubble('user', task.title);
  task.logs.forEach((log) => {
    if (log.content.startsWith('[오류] ')) {
      addBubble('error', log.content.slice('[오류] '.length));
    } else {
      addBubble('assistant', log.content);
    }
  });
  if (task.logs.length === 0) {
    addBubble('error', '(응답을 받기 전에 종료된 작업입니다)');
  }

  viewingTaskId = taskId;
  renderHistoryActiveState();
}

historySearch.addEventListener('input', renderHistoryList);

clearHistoryBtn.addEventListener('click', async () => {
  if (!confirm('작업 기록을 전부 삭제할까요? 되돌릴 수 없습니다.')) return;
  await window.caelus.clearHistory();
  clearConversation();
  viewingTaskId = null;
  loadHistory();
});

// ===================================================================
// 사용량 — 세션(5시간)/주간 한도 %는 Claude 계정 자체의 정보라 CLI로 조회할
// 방법이 없다(실사용 중 확인됨). 흉내내는 대신 실제 페이지를 열어준다.
// ===================================================================
usageLinkBtn.addEventListener('click', () => {
  window.caelus.openUsagePage();
});

// ===================================================================
// 프로젝트(작업 폴더) 선택
// ===================================================================
async function loadProjects() {
  const projects = await window.caelus.listProjects();
  const current = projectSelect.value;
  projectSelect.innerHTML = '<option value="">(projects\\ 루트)</option>';
  projects.forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    projectSelect.appendChild(opt);
  });
  if (projects.includes(current)) projectSelect.value = current;
}

newProjectBtn.addEventListener('click', async () => {
  const name = prompt('새 프로젝트 폴더 이름을 입력하세요:');
  if (!name || !name.trim()) return;
  const result = await window.caelus.createProject(name);
  if (!result.created) {
    alert(result.reason || '폴더를 만들지 못했습니다.');
    return;
  }
  await loadProjects();
  projectSelect.value = result.name;
});

// ===================================================================
// 자주 쓰는 명령(프리셋) — 입력창에 채워주기만 함(바로 전송하지 않음)
// ===================================================================
document.querySelectorAll('.preset-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    input.value = btn.dataset.text;
    input.focus();
  });
});

// ===================================================================
// 대화 내보내기
// ===================================================================
exportBtn.addEventListener('click', async () => {
  const bubbles = Array.from(conversation.querySelectorAll('.bubble'));
  if (bubbles.length === 0) {
    alert('내보낼 대화 내용이 없습니다.');
    return;
  }
  const roleLabel = (el) => {
    if (el.classList.contains('user')) return '**나**';
    if (el.classList.contains('error')) return '**오류**';
    return '**Claude**';
  };
  const md = bubbles
    .map((el) => {
      const contentEl = el.querySelector('.bubble-content');
      const raw = contentEl ? contentEl.dataset.raw || contentEl.textContent : el.textContent;
      return `${roleLabel(el)}\n\n${raw}\n`;
    })
    .join('\n---\n\n');

  const result = await window.caelus.exportConversation(md, `caelus-conversation-${Date.now()}.md`);
  if (result.saved) alert(`저장했습니다:\n${result.filePath}`);
});

// ===================================================================
// 자체 업데이트 확인 (자동 pull은 하지 않음 — 확인만)
// ===================================================================
checkUpdateBtn.addEventListener('click', async () => {
  updateStatus.textContent = '확인 중...';
  const result = await window.caelus.checkUpdate();
  if (!result.checked) {
    updateStatus.textContent = '확인 실패 (오프라인?)';
    return;
  }
  updateStatus.textContent = result.updateAvailable
    ? `업데이트 ${result.commitsBehind}개 있음 — git pull 하세요`
    : '최신 버전입니다';
});

// ===================================================================
// 명령 전송 / 스트리밍 / 취소
// ===================================================================
function setBusy(busy) {
  isBusy = busy;
  input.disabled = busy;
  submitBtn.disabled = busy;
  cancelBtn.hidden = !busy;
}

window.caelus.onStatus(({ state, taskId }) => {
  clearTimeout(idleTimer);
  setState(state);
  if (state === 'listening') {
    pendingTaskId = taskId;
    streamedText = '';
  }
  if (state === 'response') playBeep('response');
  if (state === 'error') playBeep('error');
  if (state === 'response' || state === 'error') {
    idleTimer = setTimeout(() => setState('idle'), 4000);
  }
});

window.caelus.onStream(({ taskId, chunk }) => {
  if (taskId !== pendingTaskId) return;
  if (!pendingBubble) pendingBubble = addBubble('assistant', '');
  streamedText += chunk;
  setBubbleContent(pendingBubble.contentEl, 'assistant', streamedText);
  conversation.scrollTop = conversation.scrollHeight;
});

cancelBtn.addEventListener('click', async () => {
  if (!pendingTaskId) return;
  await window.caelus.cancelCommand(pendingTaskId);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || isBusy) return;

  // 새 명령을 보내면 지금 보고 있던 화면(과거 기록이든 이전 대화든)을 지우고
  // 새 교환 하나를 새로 시작한다 — CLI 호출 자체가 매번 독립적인 1회성
  // 요청이라, "이어서 대화"가 아니라 "새 질문"에 더 가깝기 때문이다.
  clearConversation();
  viewingTaskId = null;

  addBubble('user', text);
  input.value = '';
  setBusy(true);

  const projectName = projectSelect.value;

  try {
    const result = await window.caelus.sendCommand(text, currentMode, projectName);
    if (pendingBubble) {
      setBubbleContent(pendingBubble.contentEl, 'assistant', result.text);
    } else {
      addBubble('assistant', result.text);
    }
  } catch (err) {
    if (pendingBubble) pendingBubble.el.remove();
    addBubble('error', err.message || String(err));
  } finally {
    pendingBubble = null;
    pendingTaskId = null;
    setBusy(false);
    loadHistory();
  }
});

// ===================================================================
// 단축키: Ctrl/Cmd+K로 기록 검색 포커스, Esc로 취소 또는 입력창 비우기
// (Enter 전송은 <input>의 기본 동작이라 별도 처리 불필요)
// ===================================================================
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    historySearch.focus();
  }
  if (event.key === 'Escape') {
    if (!settingsPanel.hidden) {
      settingsPanel.hidden = true;
    } else if (isBusy) {
      cancelBtn.click();
    } else if (document.activeElement === input && input.value) {
      input.value = '';
    }
  }
});

// ===================================================================
// 초기 로드
// ===================================================================
setState('idle');
loadHistory();
loadProjects();
