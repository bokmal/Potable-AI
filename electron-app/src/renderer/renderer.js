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
const threadStatusEl = document.getElementById('thread-status');
const threadStatusLabel = document.getElementById('thread-status-label');
const newThreadBtn = document.getElementById('new-thread-btn');
const threadWarning = document.getElementById('thread-warning');
const resumeBanner = document.getElementById('resume-banner');
const resumeThreadBtn = document.getElementById('resume-thread-btn');
const osMenuToggle = document.getElementById('os-menu-toggle');
const osMenuList = document.getElementById('os-menu-list');
const menuRecentEl = document.getElementById('menu-recent');

// 패키징된 앱에는 개발자 도구가 없어서, 버튼을 눌러도 뒷단(IPC/main
// 프로세스)에서 조용히 실패하면 사용자 눈에는 "아무 반응이 없다"로만
// 보인다. try/catch를 안 붙인 async 핸들러가 하나라도 있으면 재현이
// 안 되므로, 마지막 안전망으로 처리되지 않은 실패를 화면에 직접 띄운다.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[CAELUS] 처리되지 않은 오류:', event.reason);
  const message = event.reason && event.reason.message ? event.reason.message : String(event.reason);
  alert(`예상치 못한 오류가 발생했습니다:\n${message}`);
});

const STATE_LABEL = {
  idle: '대기',
  listening: '작업 중',
  response: '응답 완료',
  error: '오류',
};

const MODE_LABEL = {
  chat: '일반 대화',
  code: '코딩 작업',
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
// 좌상단 메뉴(os-menu) + 좌측에 도킹되는 패널(.floating-panel) — 프로젝트/
// 작업 상태/작업 공간/설정은 항상 화면에 있는 게 아니라, 이 메뉴에서
// 열어야만 나타나는 독립된 창이다. 여러 개를 동시에 열어둘 수 있고, 전부
// 화면 왼쪽(.panel-dock) 한 곳에 세로로 쌓인다 — 자유롭게 드래그해서
// 어디로든 옮기던 이전 방식은 버렸다(각기 다른 기본 위치가 서로 겹치거나
// 메뉴와 겹치는 문제, z-index가 한없이 올라가는 문제, 드래그 중 창 밖에서
// 마우스를 놓으면 안 끝나는 문제가 전부 이 방식 때문이었다 — 자유 위치
// 자체를 없애면 그 문제들이 설계상 발생할 수 없다). 닫는 건 각 패널의
// ✕ 버튼뿐이다 — 설정 패널도 다른 패널과 동일하게 동작한다.
// ===================================================================
function openPanel(panel) {
  if (!panel) return;
  panel.hidden = false;
}

function closeOsMenu() {
  osMenuList.hidden = true;
}

osMenuToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  osMenuList.hidden = !osMenuList.hidden;
});

document.querySelectorAll('[data-panel-target]').forEach((btn) => {
  btn.addEventListener('click', () => {
    openPanel(document.getElementById(btn.dataset.panelTarget));
    closeOsMenu();
  });
});

settingsToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  openPanel(settingsPanel);
  closeOsMenu();
});

// 메뉴 바깥을 클릭하면 드롭다운만 닫는다 — 이미 열어둔 패널들은 그대로
// 둔다(위젯이니까 다른 곳을 눌렀다고 사라지면 안 된다).
document.addEventListener('click', (event) => {
  if (!osMenuList.hidden && !event.target.closest('.os-menu')) {
    closeOsMenu();
  }
});

document.querySelectorAll('.floating-panel [data-close-panel]').forEach((closeBtn) => {
  closeBtn.addEventListener('click', () => {
    const panel = closeBtn.closest('.floating-panel');
    if (panel) panel.hidden = true;
  });
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
  document.body.dataset.state = state;
  const badge = document.getElementById('system-state-badge');
  if (badge) badge.textContent = STATE_LABEL[state] || state;
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

// ===================================================================
// 화면 단계(IDLE ↔ ACTIVE) — 대화가 없을 땐 AI 코어가 화면 중앙을 크게
// 차지하고, 첫 메시지가 오가는 순간 코어가 작게 도킹되며 대화창이 그
// 자리를 넘겨받는다. 실제 전환 애니메이션은 styles.css의
// body[data-ui-phase] 규칙이 전담하고, 여기서는 "지금 대화 내용이 있는가"
// 라는 단 하나의 상태만 body에 얹어준다 — addBubble/clearConversation이라는
// 기존의 단 두 지점에서만 호출되므로 대화가 생기고 사라지는 모든 경로
// (전송/스레드 보기/새 대화 시작/기록 삭제)에서 자동으로 같이 따라간다.
// ===================================================================
function setUiPhase(phase) {
  document.body.dataset.uiPhase = phase;
}

function setBubbleContent(contentEl, role, text) {
  contentEl.dataset.raw = text;
  if (role === 'assistant') {
    contentEl.innerHTML = renderMarkdownLite(text);
  } else {
    contentEl.textContent = text;
  }
}

function bubbleRoleLabel(role) {
  if (role === 'user') return { title: '사용자 명령', meta: 'USER COMMAND' };
  if (role === 'error') return { title: '오류', meta: 'SYSTEM ERROR' };
  return { title: 'Claude 응답', meta: 'CAELUS RESPONSE' };
}

function addBubble(role, text) {
  const el = document.createElement('div');
  el.className = `bubble ${role}`;

  const labels = bubbleRoleLabel(role);
  const headEl = document.createElement('div');
  headEl.className = 'bubble-head';
  headEl.innerHTML = `<strong>${labels.title}</strong><span>${labels.meta}</span>`;
  el.appendChild(headEl);

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
  setUiPhase('active');
  conversation.scrollTop = conversation.scrollHeight;
  return { el, contentEl };
}

function clearConversation() {
  conversation.querySelectorAll('.bubble').forEach((el) => el.remove());
  conversation.classList.remove('has-messages');
  setUiPhase('idle');
}

// ===================================================================
// 프로젝트(작업 폴더) — 사이드바 트리에 쓰일 이름/라벨 유틸
// ===================================================================
function projectLabel(name) {
  return name === DEFAULT_PROJECT_NAME ? '일반 대화' : name;
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
  renderMenuRecent();
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

// 메뉴 안 "최근 대화" — 화면을 최대한 비워두고 싶다는 요청에 맞춰, 전체
// 프로젝트 트리 대신 최근 스레드 몇 개만 메뉴에서 바로 열 수 있게 한다.
// 전체 관리(검색/이름변경/삭제 등)가 필요하면 "전체 프로젝트 보기"로
// #panel-projects를 연다 — 그 기능은 그대로 남아 있다.
const MENU_RECENT_LIMIT = 4;

function renderMenuRecent() {
  if (!menuRecentEl) return;
  menuRecentEl.innerHTML = '';

  const groups = buildThreadGroups(allTasksCache);
  const flatThreads = [];
  groups.forEach((threads, project) => {
    threads.forEach((entry) => flatThreads.push({ project, entry }));
  });
  flatThreads.sort(
    (a, b) => new Date(threadLatestTask(b.entry).created_at) - new Date(threadLatestTask(a.entry).created_at)
  );

  if (flatThreads.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'menu-recent-empty';
    empty.textContent = '아직 대화 기록이 없습니다.';
    menuRecentEl.appendChild(empty);
    return;
  }

  flatThreads.slice(0, MENU_RECENT_LIMIT).forEach(({ project, entry }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-thread-item';
    const turns = threadTurnCount(entry);
    btn.innerHTML = `
      <span class="mt-title">${escapeHtml(threadDisplayTitle(entry))}</span>
      <span class="mt-meta">${escapeHtml(projectLabel(project))} · ${turns}턴</span>
    `;
    btn.addEventListener('click', () => {
      viewThread(project, entry);
      closeOsMenu();
    });
    menuRecentEl.appendChild(btn);
  });
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
  // tg-rename/tg-delete/h-delete와 같은 이유 — 전송 중에 전체 기록을
  // 지우면, 진행 중이던 요청이 끝나면서 store.setActiveThread가 방금
  // clearAll()로 지운 activeThreads를 되살릴 수 있다("지웠는데도
  // 기억한다" 경쟁 상태).
  if (isBusy) return;
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
  const turnLabel = info.turnCount > 0 ? ` · ${info.turnCount}턴` : '';
  threadStatusLabel.textContent = `📁 ${projectLabel(activeProject)}${turnLabel}`;
  // 화면엔 기본적으로 메뉴/코어/입력창만 두고 싶다는 요청에 맞춰, 이
  // 캡션도 정말 보여줄 맥락이 있을 때만(지금 턴이 쌓였거나, 과거 기록을
  // 보고 있는 중일 때만) 나타난다 — 완전히 빈 새 대화 상태에선 숨는다.
  threadStatusEl.hidden = info.turnCount === 0 && !viewingThread;
  threadWarning.hidden = info.turnCount < LONG_THREAD_TURN_THRESHOLD;
  newThreadBtn.disabled = isBusy;
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
  newThreadBtn.disabled = busy;
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
    if (!osMenuList.hidden) {
      closeOsMenu();
    } else if (isBusy) {
      cancelBtn.click();
    } else if (document.activeElement === input && input.value) {
      input.value = '';
    }
  }
});



// ===================================================================
// Command Center polish — fullscreen HUD button and local clock
// ===================================================================
const fullscreenToggle = document.getElementById('fullscreen-toggle');
if (fullscreenToggle) {
  // 다른 .os-menu-tool 버튼들과 마찬가지로 아이콘(.omt-ic)과 라벨(.omt-label)이
  // 분리된 자식 span이다 — 버튼 전체의 textContent를 통째로 덮어쓰면 이
  // 구조 자체가 사라져서(레이아웃이 깨지고 aria-hidden 처리된 아이콘 글자가
  // 그대로 텍스트로 노출됨) 라벨 span 하나만 골라 바꾼다.
  const fullscreenLabel = fullscreenToggle.querySelector('.omt-label');
  function setFullscreenLabel(active) {
    const text = active ? '창 모드로' : '전체화면';
    if (fullscreenLabel) fullscreenLabel.textContent = text;
    fullscreenToggle.title = active ? '창 모드로 전환' : '전체화면 HUD';
  }

  fullscreenToggle.addEventListener('click', async () => {
    closeOsMenu();
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        document.body.classList.add('fullscreen-hud');
        setFullscreenLabel(true);
      } else {
        await document.exitFullscreen();
      }
    } catch {
      document.body.classList.toggle('fullscreen-hud');
      setFullscreenLabel(document.body.classList.contains('fullscreen-hud'));
    }
  });

  document.addEventListener('fullscreenchange', () => {
    const active = Boolean(document.fullscreenElement);
    document.body.classList.toggle('fullscreen-hud', active);
    setFullscreenLabel(active);
  });
}

function updateSystemClock() {
  const clock = document.getElementById('system-clock');
  if (!clock) return;
  const now = new Date();
  clock.textContent = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}
updateSystemClock();
setInterval(updateSystemClock, 30000);

// ===================================================================
// 배경 패럴랙스 — 마우스가 움직이는 만큼 배경 레이어(.radar-glow/
// .ambient-grid)가 아주 살짝(최대 몇 px) 따라 움직여서 "홀로그램 공간"
// 안에 있는 듯한 깊이감을 준다. requestAnimationFrame으로 묶어서
// mousemove 자체가 렌더링을 막지 않게 한다. 값은 CSS 커스텀 프로퍼티로만
// 넘기고 실제 움직임(transform)은 styles.css가 담당한다.
// ===================================================================
let parallaxFrame = null;
document.addEventListener('mousemove', (event) => {
  if (parallaxFrame) return;
  parallaxFrame = requestAnimationFrame(() => {
    parallaxFrame = null;
    const x = (event.clientX / window.innerWidth - 0.5) * 2; // -1..1
    const y = (event.clientY / window.innerHeight - 0.5) * 2;
    document.documentElement.style.setProperty('--parallax-x', x.toFixed(3));
    document.documentElement.style.setProperty('--parallax-y', y.toFixed(3));
  });
});

// ===================================================================
// 초기 로드
// ===================================================================
setState('idle');
setUiPhase('idle');
(async () => {
  await loadProjects();
  await loadHistory();
  await refreshThreadStatus();
})();

// =====================================================================
// CAELUS CORE / ECHO ENTITY — 파티클 캔버스 (시각효과 전용)
//
// #ring 안의 <canvas class="core-canvas">에 그리는 순수 눈요기 코드다.
// 여기서 하는 일은 딱 두 가지뿐: #ring의 클래스(idle/listening/response/
// error)를 "읽기만" 해서 파티클 속도/밀도를 바꾸는 것, 그리고 캔버스에
// 그림을 그리는 것. 위쪽의 setState()/setUiPhase()나 다른 어떤 기능
// 로직도 호출하거나 바꾸지 않는다 — 전송/취소/프로젝트/설정 버튼 동작에는
// 전혀 관여하지 않고, 캔버스 자체는 CSS에서 pointer-events:none이라 클릭도
// 가로채지 않는다.
// =====================================================================
(function initCoreParticles() {
  const canvas = document.querySelector('#ring .core-canvas');
  if (!canvas || typeof canvas.getContext !== 'function') return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const reduceMotionQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduceMotion = reduceMotionQuery ? reduceMotionQuery.matches : false;
  if (reduceMotionQuery && reduceMotionQuery.addEventListener) {
    reduceMotionQuery.addEventListener('change', (event) => {
      reduceMotion = event.matches;
      if (reduceMotion) drawStatic(readState());
    });
  }

  // 색은 하드코딩하지 않고 styles.css의 디자인 토큰(:root)에서 읽는다 —
  // 테마(다크/라이트) 전환 시 자동으로 맞는 색을 쓰기 위함. data-theme
  // 속성이 바뀌면 다시 읽는다.
  let colors = readColors();
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    return {
      blue: cs.getPropertyValue('--idle').trim() || '#5de8ff',
      blueBright: cs.getPropertyValue('--accent-2').trim() || '#baffff',
      echo: cs.getPropertyValue('--echo').trim() || '#ff5c70',
      echoHot: cs.getPropertyValue('--echo-hot').trim() || '#ff8a5b',
      error: cs.getPropertyValue('--error').trim() || '#ff647d',
    };
  }
  const themeObserver = new MutationObserver(() => {
    colors = readColors();
  });
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  let width = 0;
  let height = 0;

  // 두 코어(파란/주황)의 중심·반경. 캔버스 크기가 바뀔 때(창 크기 변경,
  // 전체화면 전환)만 다시 계산한다 — IDLE↔ACTIVE 도킹은 #ring 자체에
  // CSS transform:scale()이 걸리는 것뿐이라 캔버스도 그대로 같이
  // 줄어들고, 내부 좌표계는 안 건드려도 된다.
  const blue = { x: 0, y: 0, r: 0 };
  const orange = { x: 0, y: 0, r: 0 };
  function layoutCores() {
    const s = Math.min(width, height);
    blue.x = width * 0.56;
    blue.y = height * 0.52;
    blue.r = s * 0.30;
    orange.x = width * 0.28;
    orange.y = height * 0.40;
    orange.r = s * 0.15;
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    layoutCores();
    if (reduceMotion) drawStatic(readState());
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  // 파란 AI: 크고, 질서정연하고, 안정적으로 순환한다.
  const BLUE_COUNT = 190;
  const blueParticles = [];
  for (let i = 0; i < BLUE_COUNT; i++) {
    blueParticles.push({
      angle: rand(0, Math.PI * 2),
      angleSpeed: rand(0.05, 0.16) * (Math.random() < 0.5 ? -1 : 1),
      radiusScale: rand(0.35, 1),
      wobbleFreqA: rand(0.6, 1.4),
      wobbleFreqB: rand(0.3, 0.9),
      wobblePhase: rand(0, Math.PI * 2),
      wobbleAmp: rand(0.04, 0.12),
      size: rand(0.6, 1.9),
      alphaBase: rand(0.35, 0.9),
      twinkleFreq: rand(0.4, 1.1),
      twinklePhase: rand(0, Math.PI * 2),
    });
  }

  // 주황 AI: 더 작고, 불안정하고, 흔들림이 크다 — 파란 AI를 간섭하는 에코.
  const ORANGE_COUNT = 90;
  const orangeParticles = [];
  for (let i = 0; i < ORANGE_COUNT; i++) {
    orangeParticles.push({
      angle: rand(0, Math.PI * 2),
      angleSpeed: rand(0.08, 0.26) * (Math.random() < 0.5 ? -1 : 1),
      radiusScale: rand(0.4, 1.15),
      wobbleFreqA: rand(0.8, 2.0),
      wobbleFreqB: rand(0.5, 1.6),
      wobblePhase: rand(0, Math.PI * 2),
      wobbleAmp: rand(0.10, 0.26),
      size: rand(0.6, 1.7),
      alphaBase: rand(0.25, 0.75),
      twinkleFreq: rand(0.8, 2.2),
      twinklePhase: rand(0, Math.PI * 2),
    });
  }

  // 스트림: 두 코어 사이를 오가며 흐르는 점들 — "대화/충돌" 느낌.
  // idle에서는 거의 쉬고 있다가 listening/error에서 활발해진다.
  const STREAM_COUNT = 36; // 190+90+36 = 316개, 요청 범위(220~420) 안.
  const streamParticles = [];
  function makeStreamParticle() {
    return {
      t: -1, // -1이면 대기(비활성) 상태, 0~1이면 이동 중
      duration: rand(0.9, 1.8),
      reverse: Math.random() < 0.5, // true면 파란→주황, false면 주황→파란
      curve: rand(-0.35, 0.35),
      size: rand(0.7, 1.6),
      delay: rand(0, 2.2),
    };
  }
  for (let i = 0; i < STREAM_COUNT; i++) streamParticles.push(makeStreamParticle());

  const ring = document.getElementById('ring');
  function readState() {
    if (!ring) return 'idle';
    if (ring.classList.contains('error')) return 'error';
    if (ring.classList.contains('response')) return 'response';
    if (ring.classList.contains('listening')) return 'listening';
    return 'idle';
  }

  // 상태별 속도/밀도/스트림 파라미터 — setState()가 바꾼 클래스를 읽기만
  // 한다(쓰지 않음).
  const STATE_PARAMS = {
    idle: { speed: 1, pull: 1, orangeJitter: 1, streamSpawn: 0.12 },
    listening: { speed: 2.3, pull: 0.86, orangeJitter: 1.7, streamSpawn: 3.4 },
    response: { speed: 1.3, pull: 0.94, orangeJitter: 1.1, streamSpawn: 0.6 },
    error: { speed: 1.7, pull: 1, orangeJitter: 2.3, streamSpawn: 2.2 },
  };

  let prevState = readState();
  let pulseStart = -1; // response로 막 전환된 시각(초) — 한 번만 재생
  let sparkStart = -1; // error로 막 전환된 시각(초) — 한 번만 재생
  let elapsed = 0;
  let lastTime = performance.now();

  function breathingScale() {
    return 1 + Math.sin(elapsed * 0.62) * 0.035;
  }

  function particlePos(core, particle, radiusMul) {
    const wob =
      1 +
      Math.sin(elapsed * particle.wobbleFreqA + particle.wobblePhase) * particle.wobbleAmp +
      Math.sin(elapsed * particle.wobbleFreqB + particle.wobblePhase * 1.7) * particle.wobbleAmp * 0.6;
    const r = core.r * particle.radiusScale * radiusMul * wob;
    return { x: core.x + Math.cos(particle.angle) * r, y: core.y + Math.sin(particle.angle) * r };
  }

  function bezierPoint(a, b, c, t) {
    const u = 1 - t;
    return u * u * a + 2 * u * t * b + t * t * c;
  }

  // 색 문자열(#rrggbb 형태의 CSS 변수 값)에 알파를 입혀 rgba()로 바꾼다.
  function withAlpha(hex, alpha) {
    const c = String(hex).trim();
    if (c[0] === '#') {
      const n = c.length === 4 ? c.slice(1).split('').map((ch) => ch + ch).join('') : c.slice(1);
      const r = parseInt(n.slice(0, 2), 16);
      const g = parseInt(n.slice(2, 4), 16);
      const b = parseInt(n.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(',').map((s) => s.trim());
      return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${alpha})`;
    }
    return c;
  }

  function drawDot(x, y, size, alpha, color) {
    ctx.beginPath();
    ctx.fillStyle = withAlpha(color, Math.max(0, alpha));
    ctx.arc(x, y, Math.max(0.4, size), 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGlow(x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, withAlpha(color, alpha));
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function updateStreams(dt, params) {
    streamParticles.forEach((p) => {
      if (p.t < 0) {
        p.delay -= dt * params.speed;
        if (p.delay <= 0 && Math.random() < params.streamSpawn * dt) p.t = 0;
        return;
      }
      p.t += (dt * params.speed) / p.duration;
      if (p.t >= 1) {
        Object.assign(p, makeStreamParticle());
        p.delay = rand(0.05, 1.4) / Math.max(0.3, params.streamSpawn);
      }
    });
  }

  function render(state, params) {
    ctx.clearRect(0, 0, width, height);

    // 코어당 배경 글로우 하나씩 — 파티클 개별 shadowBlur 대신 그라디언트
    // 한 번으로 처리해 성능을 아낀다.
    drawGlow(blue.x, blue.y, blue.r * 1.5, colors.blue, state === 'listening' ? 0.16 : 0.11);
    drawGlow(orange.x, orange.y, orange.r * 1.8, colors.echo, state === 'error' ? 0.16 : 0.08);

    const breathe = breathingScale();

    blueParticles.forEach((p) => {
      p.angle += p.angleSpeed * 0.016 * params.speed;
      const { x, y } = particlePos(blue, p, params.pull * breathe);
      const twinkle = 0.6 + Math.sin(elapsed * p.twinkleFreq + p.twinklePhase) * 0.4;
      drawDot(x, y, p.size, p.alphaBase * twinkle, colors.blue);
    });

    orangeParticles.forEach((p) => {
      p.angle += p.angleSpeed * 0.016 * params.speed * (0.7 + params.orangeJitter * 0.3);
      const extraWobble = 1 + Math.sin(elapsed * 3.1 + p.twinklePhase) * 0.05 * params.orangeJitter;
      const { x, y } = particlePos(orange, p, extraWobble);
      const twinkle = 0.5 + Math.sin(elapsed * p.twinkleFreq * params.orangeJitter + p.twinklePhase) * 0.5;
      drawDot(x, y, p.size, p.alphaBase * twinkle, state === 'error' ? colors.error : colors.echo);
    });

    // 두 코어 사이 스트림 — 대부분은 점, 아주 일부(약 5~10%)만 옅은 연결선.
    let lineBudget = Math.max(1, Math.round(STREAM_COUNT * 0.08));
    streamParticles.forEach((p) => {
      if (p.t < 0 || p.t > 1) return;
      const from = p.reverse ? blue : orange;
      const to = p.reverse ? orange : blue;
      const mx = (from.x + to.x) / 2 + (to.y - from.y) * p.curve;
      const my = (from.y + to.y) / 2 - (to.x - from.x) * p.curve;
      const x = bezierPoint(from.x, mx, to.x, p.t);
      const y = bezierPoint(from.y, my, to.y, p.t);
      const fade = p.t < 0.15 ? p.t / 0.15 : p.t > 0.8 ? (1 - p.t) / 0.2 : 1;
      const color = state === 'error' ? colors.error : colors.echoHot;

      if (lineBudget > 0 && p.curve > -0.05 && p.curve < 0.05) {
        ctx.strokeStyle = withAlpha(colors.blue, 0.06 * fade);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.quadraticCurveTo(mx, my, to.x, to.y);
        ctx.stroke();
        lineBudget -= 1;
      }

      drawDot(x, y, p.size, 0.85 * fade, color);
      if (p.t > 0.92 && to === blue) drawDot(x, y, p.size * 2.2, 0.18 * fade, colors.blueBright);
    });

    // response: 파란 코어에서 부드러운 pulse가 한 번 퍼진다.
    if (pulseStart >= 0) {
      const pt = elapsed - pulseStart;
      if (pt < 1.1) {
        const pr = blue.r * (0.3 + pt * 1.3);
        ctx.strokeStyle = withAlpha(colors.blueBright, Math.max(0, 0.32 * (1 - pt / 1.1)));
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(blue.x, blue.y, pr, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        pulseStart = -1;
      }
    }

    // error: 아주 짧은 경고성 스파크만(화면 전체를 붉게 물들이지 않는다).
    if (sparkStart >= 0) {
      const st = elapsed - sparkStart;
      if (st < 0.6) {
        const sparkCount = 5;
        for (let i = 0; i < sparkCount; i++) {
          const a = (i / sparkCount) * Math.PI * 2 + elapsed * 2;
          const sr = orange.r * (0.8 + Math.sin(elapsed * 9 + i) * 0.15);
          drawDot(
            orange.x + Math.cos(a) * sr,
            orange.y + Math.sin(a) * sr,
            1.6,
            Math.max(0, 0.5 * (1 - st / 0.6)),
            colors.error
          );
        }
      } else {
        sparkStart = -1;
      }
    }
  }

  // prefers-reduced-motion: 파티클을 홈 위치에 고정해 한 번만 그린다(계속
  // requestAnimationFrame을 돌리지 않음).
  function drawStatic(state) {
    ctx.clearRect(0, 0, width, height);
    drawGlow(blue.x, blue.y, blue.r * 1.4, colors.blue, 0.1);
    drawGlow(orange.x, orange.y, orange.r * 1.6, colors.echo, state === 'error' ? 0.14 : 0.07);
    blueParticles.forEach((p) => {
      const { x, y } = particlePos(blue, p, 1);
      drawDot(x, y, p.size, p.alphaBase * 0.8, colors.blue);
    });
    orangeParticles.forEach((p) => {
      const { x, y } = particlePos(orange, p, 1);
      drawDot(x, y, p.size, p.alphaBase * 0.7, state === 'error' ? colors.error : colors.echo);
    });
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (reduceMotion) return; // 정적 프레임은 상태 변화/리사이즈 때만 다시 그림
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    elapsed += dt;

    const state = readState();
    if (state !== prevState) {
      if (state === 'response') pulseStart = elapsed;
      if (state === 'error') sparkStart = elapsed;
      prevState = state;
    }
    const params = STATE_PARAMS[state] || STATE_PARAMS.idle;
    updateStreams(dt, params);
    render(state, params);
  }

  window.addEventListener('resize', resizeCanvas);
  document.addEventListener('fullscreenchange', resizeCanvas);

  resizeCanvas();
  if (reduceMotion) drawStatic(readState());
  requestAnimationFrame(frame);
})();
