// --- DOM 참조 ---
const ring = document.getElementById('ring');
const statusText = document.getElementById('status-text');
const conversation = document.getElementById('conversation');
const form = document.getElementById('command-form');
const input = document.getElementById('command-input');
const submitBtn = form.querySelector('.command-submit');
const cancelBtn = document.getElementById('cancel-btn');
const historySearch = document.getElementById('history-search');
const historyEmpty = document.getElementById('history-empty');
const projectGroupsEl = document.getElementById('project-groups');
const generalGroupsEl = document.getElementById('general-groups');
const searchResultsEl = document.getElementById('search-results');
const clearHistoryBtn = document.getElementById('clear-history-btn');
const modeButtons = document.querySelectorAll('.mode-btn');
const settingsToggle = document.getElementById('settings-toggle');
const settingsPanel = document.getElementById('settings-panel');
const themeToggle = document.getElementById('theme-toggle');
const themeToggleLabel = document.getElementById('theme-toggle-label');
const newProjectBtn = document.getElementById('new-project-btn');
const newProjectInput = document.getElementById('new-project-input');
const exportBtn = document.getElementById('export-btn');
const checkUpdateBtn = document.getElementById('check-update-btn');
const updateStatus = document.getElementById('update-status');
const usageLinkBtn = document.getElementById('usage-link-btn');
const threadStatusLabel = document.getElementById('thread-status-label');
const newThreadBtn = document.getElementById('new-thread-btn');
const threadWarning = document.getElementById('thread-warning');
const resumeBanner = document.getElementById('resume-banner');
const resumeThreadBtn = document.getElementById('resume-thread-btn');

// --- 커맨드 센터 UI (인스펙터 / 상단바 / 전체화면) 참조 ---
// 이 섹션의 엘리먼트는 전부 "표시용"이다 — 여기 값을 읽거나 바꾸는 게 실제
// 동작(전송/취소/프로젝트 관리 등)에 영향을 주지 않고, 기존 상태를 그대로
// 반영만 한다. 새 IPC는 추가하지 않았다.
const inspectorState = document.getElementById('inspector-state');
const inspectorProject = document.getElementById('inspector-project');
const inspectorMode = document.getElementById('inspector-mode');
const inspectorThread = document.getElementById('inspector-thread');
const inspectorStream = document.getElementById('inspector-stream');
const inspectorSurfaceProject = document.getElementById('inspector-surface-project');
const activityFeed = document.getElementById('activity-feed');
const topbarProjectName = document.getElementById('topbar-project-name');
const fullscreenToggle = document.getElementById('fullscreen-toggle');

function pushActivity(label, detail) {
  if (!activityFeed) return;
  const item = document.createElement('div');
  item.className = 'activity-item';
  item.innerHTML = `<span>${escapeHtml(label)}</span><small>${escapeHtml(detail || '')}</small>`;
  activityFeed.prepend(item);
  while (activityFeed.children.length > 6) activityFeed.lastElementChild.remove();
}

// 패키징된 앱에는 개발자 도구가 없어서, 버튼을 눌러도 뒷단(IPC/main
// 프로세스)에서 조용히 실패하면 사용자 눈에는 "아무 반응이 없다"로만
// 보인다. try/catch를 안 붙인 async 핸들러가 하나라도 있으면 재현이
// 안 되므로, 마지막 안전망으로 처리되지 않은 실패를 화면에 직접 띄운다.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[CAELUS] 처리되지 않은 오류:', event.reason);
  const message = event.reason && event.reason.message ? event.reason.message : String(event.reason);
  alert(`예상치 못한 오류가 발생했습니다:\n${message}`);
});

// UI 크롬(상태 라벨/버튼/헤더)은 커맨드 센터 컨셉에 맞춰 영어로 표시하고,
// 실제 대화 내용과 경고/확인 문구처럼 사용자가 정확히 이해해야 하는 설명
// 문장은 계속 한국어로 남긴다(아래 alert/confirm 문구들이 그 예).
const STATE_LABEL = {
  idle: 'AWAITING INSTRUCTION',
  listening: 'PROCESSING COMMAND',
  response: 'RESPONSE COMPLETE',
  error: 'SYSTEM ERROR',
};

const MODE_LABEL = {
  chat: 'CHAT',
  code: 'CODE',
};

// 대화 한 스레드가 이 턴 수 이상이면 "길어졌다" 안내를 보여준다. 실제 토큰
// 수를 로컬에서 정확히 잴 방법이 없어(CLI가 알려주지 않음) 턴 수 기반의
// 대략적인 휴리스틱으로 둔다.
const LONG_THREAD_TURN_THRESHOLD = 15;
const DEFAULT_PROJECT_NAME = 'general';

let idleTimer = null;
let isBusy = false;
let activeProject = DEFAULT_PROJECT_NAME; // 지금 입력창이 보낼 대상 프로젝트
let viewingThread = null; // 사이드바에서 눌러 다시 보고 있는 과거 스레드 { project, threadId } (있으면)
let pendingTaskId = null; // 지금 진행 중인 요청의 taskId
let pendingBubble = null; // 그 요청의 스트리밍 대상 말풍선 { el, contentEl }
let streamedText = '';
let allTasksCache = [];
let projectsCache = [DEFAULT_PROJECT_NAME];
let collapsedGroups = new Set(); // 펼치기/접기 상태(project 이름 기준), 기본은 전부 펼침

try {
  const saved = JSON.parse(localStorage.getItem('caelus-collapsed-groups') || '[]');
  if (Array.isArray(saved)) collapsedGroups = new Set(saved);
} catch {
  // 저장값이 없거나 손상돼도 기본(전부 펼침)으로 진행
}

function saveCollapsedGroups() {
  try {
    localStorage.setItem('caelus-collapsed-groups', JSON.stringify([...collapsedGroups]));
  } catch {
    // 저장 실패해도 이번 세션 표시에는 지장 없음
  }
}

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
  themeToggleLabel.textContent = theme === 'light' ? 'LIGHT ☀' : 'DARK ☾';
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
  if (inspectorMode) inspectorMode.textContent = MODE_LABEL[mode] || mode.toUpperCase();
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
  if (inspectorState) {
    inspectorState.textContent = state === 'idle' ? 'READY' : (STATE_LABEL[state] || state).split(' ')[0];
    inspectorState.classList.toggle('is-busy', state === 'listening');
    inspectorState.classList.toggle('is-error', state === 'error');
  }
  if (inspectorStream && state !== 'listening') {
    inspectorStream.textContent = 'IDLE';
  }
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
    copyBtn.textContent = 'COPY';
    copyBtn.addEventListener('click', async () => {
      await window.caelus.copyText(contentEl.dataset.raw || '');
      copyBtn.textContent = 'COPIED';
      setTimeout(() => {
        copyBtn.textContent = 'COPY';
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
// 프로젝트(작업 폴더) — 사이드바 트리에 쓰일 이름/라벨 유틸
// ===================================================================
function projectLabel(name) {
  return name === DEFAULT_PROJECT_NAME ? 'GENERAL (auto-sorted)' : name;
}

async function loadProjects() {
  projectsCache = await window.caelus.listProjects();
  if (!projectsCache.includes(activeProject)) activeProject = DEFAULT_PROJECT_NAME;
}

// ===================================================================
// 작업 기록(사이드바) — 조회 / 트리 렌더링 / 검색 / 스레드 보기 / 삭제
// ===================================================================
async function loadHistory() {
  allTasksCache = await window.caelus.getHistory();
  renderHistoryTree();
}

// task.project가 지금 존재하는 프로젝트 폴더 목록에 없으면(프로젝트 삭제 후
// 남은 과거 기록) "일반" 그룹으로 자동 재배치해서 보여준다 — 고아 데이터 방지.
function effectiveProject(task) {
  const p = task.project || DEFAULT_PROJECT_NAME;
  if (p === DEFAULT_PROJECT_NAME) return DEFAULT_PROJECT_NAME;
  return projectsCache.includes(p) ? p : DEFAULT_PROJECT_NAME;
}

// 같은 스레드(claude_session_id)에 속한 여러 task를 사이드바에 중복으로
// 나열하지 않도록, 프로젝트별로 스레드 단위 그룹을 만든다. 스레드가 없는
// (옛 기록, claude_session_id가 없는) task는 각자 자기 자신이 스레드다.
function buildThreadGroups(tasks) {
  const byProject = new Map(); // project -> Map(threadKey -> { threadId, tasks: [] })
  tasks.forEach((task) => {
    const project = effectiveProject(task);
    if (!byProject.has(project)) byProject.set(project, new Map());
    const threads = byProject.get(project);
    const threadKey = task.claude_session_id || `__task_${task.task_id}`;
    if (!threads.has(threadKey)) {
      threads.set(threadKey, { threadId: task.claude_session_id || null, tasks: [] });
    }
    threads.get(threadKey).tasks.push(task);
  });
  return byProject;
}

function threadDisplayTitle(threadEntry) {
  // 최신(가장 먼저 온, allTasksCache가 최신순이므로 배열의 첫 항목) task의
  // 제목을 대표 제목으로 쓴다.
  return threadEntry.tasks[0].title;
}

function threadTurnCount(threadEntry) {
  return threadEntry.tasks.length;
}

function threadLatestTask(threadEntry) {
  return threadEntry.tasks[0];
}

function makeGroupHeader(project, threadCount) {
  const header = document.createElement('div');
  header.className = 'tree-group-header';
  header.dataset.project = project;

  const isCollapsed = collapsedGroups.has(project);
  header.innerHTML = `
    <span class="tree-caret ${isCollapsed ? 'collapsed' : ''}">&#9662;</span>
    <span class="tree-group-name">${escapeHtml(projectLabel(project))}</span>
    <span class="tree-group-badge">${threadCount}</span>
    <span class="tree-group-actions">
      <button type="button" class="tg-action tg-new" title="이 프로젝트로 새 대화 시작">&#43;</button>
      ${project === DEFAULT_PROJECT_NAME ? '' : `
        <button type="button" class="tg-action tg-rename" title="이름변경">&#9998;</button>
        <button type="button" class="tg-action tg-delete" title="삭제">&#128465;</button>
      `}
    </span>
  `;

  // 헤더 클릭(캐럿/이름 부분) = 펼치기/접기만. 화면(활성 프로젝트/대화창)은
  // 안 바뀐다 — 액션 버튼 영역 클릭은 여기서 걸러낸다(아래서 각각 처리).
  header.addEventListener('click', (event) => {
    if (event.target.closest('.tree-group-actions')) return;
    toggleGroupCollapsed(project);
  });

  header.querySelector('.tg-new').addEventListener('click', (event) => {
    event.stopPropagation();
    startNewThreadForProject(project);
  });

  const renameBtn = header.querySelector('.tg-rename');
  if (renameBtn) {
    renameBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      // 메시지 전송 중에는 손대지 않는다 — 진행 중인 요청이 main.js에서
      // 끝난 뒤 store.setActiveThread(targetProject, ...)로 activeThreads를
      // 다시 덮어쓰므로, 그 사이에 이름을 바꾸면(project 키가 옮겨짐) 요청이
      // 끝나는 순간 옛 이름으로 포인터가 되살아나는 경쟁 상태가 생긴다.
      if (isBusy) return;
      startProjectRename(header, project);
    });
  }

  const deleteBtn = header.querySelector('.tg-delete');
  if (deleteBtn) {
    deleteBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      // 위 renameBtn과 같은 이유로, 진행 중인 요청이 있으면 삭제도 막는다.
      if (isBusy) return;
      const ok = confirm(
        `'${project}' 프로젝트를 삭제할까요?\n\n이 폴더 안 모든 파일이 영구 삭제됩니다. 되돌릴 수 없습니다.\n(지금까지 나눈 대화 기록은 "일반" 그룹으로 남습니다.)`
      );
      if (!ok) return;
      const result = await window.caelus.deleteProject(project);
      if (!result.deleted) {
        alert(result.reason || '삭제하지 못했습니다.');
        return;
      }
      if (activeProject === project) activeProject = DEFAULT_PROJECT_NAME;
      if (viewingThread && viewingThread.project === project) {
        clearConversation();
        viewingThread = null;
        hideResumeBanner();
      }
      await loadProjects();
      await loadHistory();
      refreshThreadStatus();
    });
  }

  return header;
}

function startProjectRename(header, project) {
  const nameEl = header.querySelector('.tree-group-name');
  const inputEl = document.createElement('input');
  inputEl.type = 'text';
  inputEl.className = 'new-project-input tree-inline-input';
  inputEl.value = project;
  nameEl.replaceWith(inputEl);
  inputEl.focus();
  inputEl.select();

  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const newName = inputEl.value.trim();
    if (!newName || newName === project) {
      renderHistoryTree();
      return;
    }
    const result = await window.caelus.renameProject(project, newName);
    if (!result.renamed) {
      alert(result.reason || '이름을 바꾸지 못했습니다.');
      renderHistoryTree();
      return;
    }
    if (activeProject === project) activeProject = result.name;
    if (viewingThread && viewingThread.project === project) viewingThread.project = result.name;
    await loadProjects();
    await loadHistory();
    refreshThreadStatus();
  };

  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      done = true;
      renderHistoryTree();
    }
  });
  inputEl.addEventListener('blur', commit);
}

function makeThreadItem(project, threadEntry) {
  const latest = threadLatestTask(threadEntry);
  const li = document.createElement('li');
  li.className = 'history-item';
  li.dataset.project = project;
  li.dataset.threadKey = threadEntry.threadId || `__task_${latest.task_id}`;
  const modeLabel = MODE_LABEL[latest.mode] || latest.mode || '';
  const turns = threadTurnCount(threadEntry);
  const turnsLabel = turns > 1 ? ` · ${turns}턴` : '';
  li.innerHTML = `
    <div class="h-title">${escapeHtml(threadDisplayTitle(threadEntry))}</div>
    <div class="h-meta">${modeLabel} · ${latest.status} · ${new Date(latest.created_at).toLocaleString('ko-KR')}${turnsLabel}</div>
    <button type="button" class="h-rename" title="제목 수정">&#9998;</button>
    <button type="button" class="h-delete" title="삭제">&#10005;</button>
  `;
  li.addEventListener('click', (event) => {
    if (event.target.closest('.h-delete') || event.target.closest('.h-rename')) return;
    viewThread(project, threadEntry);
  });
  li.querySelector('.h-rename').addEventListener('click', (event) => {
    event.stopPropagation();
    startTaskRename(li, latest);
  });
  li.querySelector('.h-delete').addEventListener('click', async (event) => {
    event.stopPropagation();
    // 메시지 전송 중에는 막는다 — 그 요청이 끝나면서 store.setActiveThread로
    // activeThreads를 다시 덮어쓰기 때문에, 그 사이 여기서 지운 활성 스레드
    // 포인터가 요청이 끝나는 순간 되살아나는 경쟁 상태가 생길 수 있다
    // (main.js caelus:send-command 참고).
    if (isBusy) return;
    if (!confirm('이 기록을 삭제할까요?')) return;
    // 스레드를 이루는 모든 task를 같이 지운다 — 하나만 지우면 나머지가
    // "제목 없는" 조각으로 남아 혼란스럽다.
    for (const t of threadEntry.tasks) {
      await window.caelus.deleteTask(t.task_id);
    }
    // 지운 스레드가 그 프로젝트의 "지금 활성 스레드"였다면 포인터도 같이
    // 지운다 — 안 그러면 기록은 사라졌는데 다음 메시지가 여전히 그 스레드를
    // --resume 해서 "지웠는데도 기억한다"는 문제가 생긴다(clearAll의
    // activeThreads 초기화 누락과 같은 종류의 버그).
    const info = await window.caelus.getThreadInfo(project);
    if (threadEntry.threadId && info.threadId === threadEntry.threadId) {
      await window.caelus.startNewThread(project);
    }
    if (viewingThread && viewingThread.project === project && viewingThread.threadId === threadEntry.threadId) {
      clearConversation();
      viewingThread = null;
      hideResumeBanner();
    }
    loadHistory();
    refreshThreadStatus();
  });
  return li;
}

function startTaskRename(li, task) {
  const titleEl = li.querySelector('.h-title');
  const inputEl = document.createElement('input');
  inputEl.type = 'text';
  inputEl.className = 'new-project-input tree-inline-input';
  inputEl.value = task.title;
  titleEl.replaceWith(inputEl);
  inputEl.focus();
  inputEl.select();

  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const newTitle = inputEl.value.trim();
    if (newTitle && newTitle !== task.title) {
      await window.caelus.renameTask(task.task_id, newTitle);
    }
    loadHistory();
  };
  inputEl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    } else if (event.key === 'Escape') {
      done = true;
      renderHistoryTree();
    }
  });
  inputEl.addEventListener('blur', commit);
}

function toggleGroupCollapsed(project) {
  if (collapsedGroups.has(project)) collapsedGroups.delete(project);
  else collapsedGroups.add(project);
  saveCollapsedGroups();
  renderHistoryTree();
}

function renderGroup(container, project, threads) {
  const group = document.createElement('div');
  group.className = 'tree-group';
  group.appendChild(makeGroupHeader(project, threads.size));

  const children = document.createElement('ul');
  children.className = 'tree-group-children';
  if (collapsedGroups.has(project)) children.hidden = true;

  // 스레드를 최신순으로(각 그룹 안의 대표 task 생성 시각 기준) 정렬한다.
  [...threads.values()]
    .sort((a, b) => new Date(threadLatestTask(b).created_at) - new Date(threadLatestTask(a).created_at))
    .forEach((threadEntry) => children.appendChild(makeThreadItem(project, threadEntry)));

  group.appendChild(children);
  container.appendChild(group);
}

function renderSearchResults(query) {
  searchResultsEl.hidden = false;
  document.querySelectorAll('.tree-section-header').forEach((h) => (h.hidden = true));
  projectGroupsEl.hidden = true;
  generalGroupsEl.hidden = true;

  const filtered = allTasksCache.filter((t) => t.title.toLowerCase().includes(query));
  searchResultsEl.innerHTML = '';
  historyEmpty.hidden = filtered.length > 0;

  const groups = buildThreadGroups(filtered);
  const flatThreads = [];
  groups.forEach((threads, project) => {
    threads.forEach((entry) => flatThreads.push({ project, entry }));
  });
  flatThreads
    .sort((a, b) => new Date(threadLatestTask(b.entry).created_at) - new Date(threadLatestTask(a.entry).created_at))
    .forEach(({ project, entry }) => {
      const li = makeThreadItem(project, entry);
      const tag = document.createElement('span');
      tag.className = 'h-project-tag';
      tag.textContent = projectLabel(project);
      li.querySelector('.h-meta').prepend(tag);
      searchResultsEl.appendChild(li);
    });
}

function renderHistoryTree() {
  const query = historySearch.value.trim().toLowerCase();

  if (query) {
    renderSearchResults(query);
    return;
  }

  searchResultsEl.hidden = true;
  document.querySelectorAll('.tree-section-header').forEach((h) => (h.hidden = false));
  projectGroupsEl.hidden = false;
  generalGroupsEl.hidden = false;

  projectGroupsEl.innerHTML = '';
  generalGroupsEl.innerHTML = '';

  const groups = buildThreadGroups(allTasksCache);
  historyEmpty.hidden = allTasksCache.length > 0;

  // "프로젝트" 섹션: general을 제외한 나머지 프로젝트를, 실제로 만들어져
  // 있는 폴더(projectsCache) 순서대로. 대화 기록이 없는 프로젝트도 빈
  // 그룹으로 보여준다(방금 만든 빈 프로젝트가 사라져 보이지 않도록).
  projectsCache
    .filter((name) => name !== DEFAULT_PROJECT_NAME)
    .forEach((name) => {
      renderGroup(projectGroupsEl, name, groups.get(name) || new Map());
    });

  // "기타 대화" 섹션: general 하나만, 항상 표시.
  renderGroup(generalGroupsEl, DEFAULT_PROJECT_NAME, groups.get(DEFAULT_PROJECT_NAME) || new Map());
}

async function viewThread(project, threadEntry) {
  if (isBusy) return; // 진행 중인 요청이 있으면 화면을 안 바꾼다(혼란 방지)

  clearConversation();
  // 스레드에 속한 task들을 시간순(오래된 것부터)으로 늘어놓는다.
  const ordered = [...threadEntry.tasks].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  for (const summary of ordered) {
    const task = await window.caelus.getTask(summary.task_id);
    if (!task) continue;
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
  }

  viewingThread = { project, threadId: threadEntry.threadId };

  // 스레드를 클릭해서 보는 순간, 화면에 보이는 프로젝트가 곧 "지금 입력창이
  // 보낼 대상"이 되도록 activeProject를 항상 그 프로젝트로 맞춘다. 이걸 안
  // 하면 화면은 A 프로젝트 대화를 보여주는데 실제 전송 대상은 예전에
  // 마지막으로 활성화됐던(또는 기본값인 general) 다른 프로젝트로 가는
  // 어긋남이 생긴다 — 사용자에게는 "프로젝트 구분 없이 전부 하나로
  // 기억되는 것처럼" 보이는 버그로 나타난다.
  activeProject = project;

  // threadId가 없는 옛 기록(스레드 개념이 생기기 전 1회성 작업)은 애초에
  // "이어갈" 스레드가 없으므로 배너를 보여주지 않는다. threadId가 있으면,
  // 지금 그 프로젝트의 활성 스레드와 같은 걸 보고 있는 게 아닐 때만
  // "이어서 대화하기" 배너를 보여준다(= 과거 기록을 훑어보는 중이라는 뜻).
  // 배너가 안 떠 있다는 건 지금 보고 있는 스레드가 곧 그 프로젝트의
  // 실제 활성 스레드라는 뜻이므로, activeThreads 포인터는 안 건드려도
  // 이미 맞다(그래서 여기서 setActiveThread를 다시 부를 필요는 없다).
  if (!threadEntry.threadId) {
    hideResumeBanner();
    await refreshThreadStatus();
    return;
  }
  const info = await window.caelus.getThreadInfo(project);
  if (info.threadId === threadEntry.threadId) {
    hideResumeBanner();
  } else {
    showResumeBanner();
  }
  await refreshThreadStatus();
}

function showResumeBanner() {
  resumeBanner.hidden = false;
}
function hideResumeBanner() {
  resumeBanner.hidden = true;
}

resumeThreadBtn.addEventListener('click', async () => {
  if (!viewingThread || !viewingThread.threadId) {
    // 이 상태에서는 원래 배너가 안 보여야 정상이지만(showResumeBanner를
    // viewingThread 설정 직후에만 부름), 혹시 어긋나 있으면 눌러도 반응이
    // 없는 것처럼 보이지 않도록 최소한 배너는 치워준다.
    hideResumeBanner();
    return;
  }
  const previousProject = activeProject;
  try {
    activeProject = viewingThread.project;
    await window.caelus.resumeThread(viewingThread.project, viewingThread.threadId);
    hideResumeBanner();
    await refreshThreadStatus();
    input.focus();
  } catch (err) {
    // 실패하면 낙관적으로 바꿔둔 activeProject를 되돌린다 — 안 그러면
    // 사용자가 이 알림을 무시하고 바로 메시지를 보낼 때, 이어가려던 그
    // 스레드가 아니라 그 프로젝트의 "지금" 활성 스레드(의도한 것과 다를
    // 수 있음)로 조용히 전송돼버린다. 배너는 그대로 띄워둔다 — 아직 이
    // 스레드가 활성화된 게 아니라는 뜻이 여전히 맞기 때문이다.
    activeProject = previousProject;
    // IPC 호출이 실패해도 조용히 묻히지 않도록 명시적으로 알려준다.
    alert(`이어서 대화하기에 실패했습니다: ${err && err.message ? err.message : err}`);
  }
});

historySearch.addEventListener('input', renderHistoryTree);

clearHistoryBtn.addEventListener('click', async () => {
  if (!confirm('작업 기록을 전부 삭제할까요? 되돌릴 수 없습니다.')) return;
  await window.caelus.clearHistory();
  clearConversation();
  viewingThread = null;
  hideResumeBanner();
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
// 새 프로젝트 만들기
// Electron은 window.prompt()를 지원하지 않는다(호출해도 다이얼로그가 안 뜨고
// 조용히 무시된다) — 화면에 직접 입력창을 보여주는 방식으로 처리한다.
// ===================================================================
function showNewProjectInput() {
  newProjectBtn.hidden = true;
  newProjectInput.hidden = false;
  newProjectInput.value = '';
  newProjectInput.focus();
}

function hideNewProjectInput() {
  newProjectInput.hidden = true;
  newProjectBtn.hidden = false;
}

newProjectBtn.addEventListener('click', showNewProjectInput);

newProjectInput.addEventListener('keydown', async (event) => {
  if (event.key === 'Escape') {
    hideNewProjectInput();
    return;
  }
  if (event.key !== 'Enter') return;
  event.preventDefault();

  const name = newProjectInput.value.trim();
  if (!name) {
    hideNewProjectInput();
    return;
  }
  const result = await window.caelus.createProject(name);
  if (!result.created) {
    alert(result.reason || '폴더를 만들지 못했습니다.');
    return;
  }
  hideNewProjectInput();
  activeProject = result.name;
  await loadProjects();
  await loadHistory();
  refreshThreadStatus();
});

newProjectInput.addEventListener('blur', hideNewProjectInput);

// ===================================================================
// 대화 스레드 연속성 — 상태 표시줄 / 새 대화 시작
// ===================================================================
async function refreshThreadStatus() {
  const info = await window.caelus.getThreadInfo(activeProject);
  const turnLabel = info.turnCount > 0 ? ` · MSG ${info.turnCount}` : '';
  threadStatusLabel.textContent = `\u{1F4C1} ${projectLabel(activeProject)}${turnLabel}`;
  threadWarning.hidden = info.turnCount < LONG_THREAD_TURN_THRESHOLD;
  newThreadBtn.disabled = isBusy;

  // 우측 인스펙터/상단 바 동기화 — 새 IPC 없이, 이미 조회한 값만 반영한다.
  const projectDisplay = projectLabel(activeProject).toUpperCase();
  if (inspectorProject) inspectorProject.textContent = projectDisplay;
  if (inspectorSurfaceProject) inspectorSurfaceProject.textContent = activeProject;
  if (topbarProjectName) topbarProjectName.textContent = projectDisplay;
  if (inspectorThread) {
    inspectorThread.textContent = info.turnCount > 0 ? `ACTIVE · ${info.turnCount}` : 'NEW';
  }
  return info;
}

async function startNewThreadForProject(project) {
  if (isBusy) return;
  const info = await window.caelus.getThreadInfo(project);
  if (info.turnCount > 0) {
    if (!confirm('지금 대화를 마치고 새로 시작할까요? (지금까지 기록은 사이드바에 남습니다)')) return;
  }
  await window.caelus.startNewThread(project);
  activeProject = project;
  clearConversation();
  viewingThread = null;
  hideResumeBanner();
  refreshThreadStatus();
  input.focus();
}

newThreadBtn.addEventListener('click', () => startNewThreadForProject(activeProject));

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
  updateStatus.textContent = 'CHECKING...';
  const result = await window.caelus.checkUpdate();
  if (!result.checked) {
    updateStatus.textContent = 'FAILED (OFFLINE?)';
    return;
  }
  updateStatus.textContent = result.updateAvailable
    ? `${result.commitsBehind} BEHIND — git pull`
    : 'UP TO DATE';
});

// ===================================================================
// 명령 전송 / 스트리밍 / 취소
// ===================================================================
function setBusy(busy) {
  isBusy = busy;
  input.disabled = busy;
  submitBtn.disabled = busy;
  cancelBtn.hidden = !busy;
  newThreadBtn.disabled = busy;
}

window.caelus.onStatus(({ state, taskId, message }) => {
  clearTimeout(idleTimer);
  setState(state);
  if (state === 'listening') {
    pendingTaskId = taskId;
    streamedText = '';
  }
  if (state === 'response') {
    playBeep('response');
    pushActivity('RESPONSE COMPLETE', activeProject);
  }
  if (state === 'error') {
    playBeep('error');
    pushActivity('SYSTEM ERROR', message || '');
  }
  if (state === 'response' || state === 'error') {
    idleTimer = setTimeout(() => setState('idle'), 4000);
  }
});

window.caelus.onStream(({ taskId, chunk }) => {
  if (taskId !== pendingTaskId) return;
  if (!pendingBubble) {
    pendingBubble = addBubble('assistant', '');
    if (inspectorStream) inspectorStream.textContent = 'STREAMING';
    pushActivity('STREAMING', 'Claude Code response');
  }
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

  // 지금 화면에 과거 기록(다른 스레드, 또는 activeProject의 지금 활성
  // 스레드가 아닌 것)을 보고 있었다면, 새 메시지는 activeProject의 활성
  // 스레드로 가므로 화면을 새로 그린다. 지금 보고 있던 게 바로 그
  // activeProject의 활성 스레드였다면(예: 이어서 대화하기 직후) 화면을
  // 그대로 두고 이어서 말풍선만 추가한다.
  if (viewingThread && !(viewingThread.project === activeProject && resumeBanner.hidden)) {
    clearConversation();
  }
  viewingThread = null;
  hideResumeBanner();

  addBubble('user', text);
  input.value = '';
  setBusy(true);
  pushActivity('COMMAND SENT', projectLabel(activeProject));

  try {
    const result = await window.caelus.sendCommand(text, currentMode, activeProject);
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
    await loadHistory();
    refreshThreadStatus();
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
// 전체화면 HUD 모드 — 렌더러(Fullscreen API)만으로 처리, BrowserWindow는
// 안 건드린다. 일반 창 모드로도, 전체화면으로도 각각 어울리게 CSS의
// body.is-fullscreen 규칙이 담당한다(styles.css 참고).
// ===================================================================
if (fullscreenToggle) {
  fullscreenToggle.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {
        // 전체화면 API가 막힌 환경(권한/플랫폼 제약)이면 조용히 무시 —
        // 일반 창 모드로도 완전히 동작하므로 치명적이지 않다.
      });
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });
}
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('is-fullscreen', !!document.fullscreenElement);
});

// ===================================================================
// 초기 로드
// ===================================================================
setState('idle');
(async () => {
  await loadProjects();
  await loadHistory();
  await refreshThreadStatus();
})();
