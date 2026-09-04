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
const safeQuitBtn = document.getElementById('safe-quit-btn');
const personaInput = document.getElementById('persona-input');
const personaProjectLabel = document.getElementById('persona-project-label');
const personaStatus = document.getElementById('persona-status');
const personaSaveBtn = document.getElementById('persona-save-btn');
const workspaceBreadcrumbEl = document.getElementById('workspace-breadcrumb');
const workspaceTreeEl = document.getElementById('workspace-tree');
const workspacePreviewEl = document.getElementById('workspace-preview');
const workspacePreviewNameEl = document.getElementById('workspace-preview-name');
const workspacePreviewContentEl = document.getElementById('workspace-preview-content');
const workspacePreviewCloseBtn = document.getElementById('workspace-preview-close');
const presetListEl = document.getElementById('preset-list');
const presetLabelInput = document.getElementById('preset-label-input');
const presetTextInput = document.getElementById('preset-text-input');
const presetAddBtn = document.getElementById('preset-add-btn');
const favoritesSectionEl = document.getElementById('favorites-section');
const favoritesListEl = document.getElementById('favorites-list');
const openExplorerBtn = document.getElementById('open-explorer-btn');
const gitSummaryEl = document.getElementById('git-summary');
const gitLogEl = document.getElementById('git-log');
const gitDiffEl = document.getElementById('git-diff');
const gitDiffTitleEl = document.getElementById('git-diff-title');
const gitDiffContentEl = document.getElementById('git-diff-content');
const gitDiffCloseBtn = document.getElementById('git-diff-close');
const statsSummaryEl = document.getElementById('stats-summary');
const statsByProjectEl = document.getElementById('stats-by-project');
const newProjectRow = document.getElementById('new-project-row');
const newProjectTemplate = document.getElementById('new-project-template');
const reassignThreadSelect = document.getElementById('reassign-thread-select');
const summarizeContinueBtn = document.getElementById('summarize-continue-btn');
const modelSelect = document.getElementById('model-select');
const queueIndicatorEl = document.getElementById('queue-indicator');

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
  cancelled: '중단됨',
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
// 패널을 연 버튼을 기억해뒀다가, 그 패널을 닫을 때(✕든 Esc든) 포커스를
// 그 버튼으로 되돌린다 — 키보드/스크린리더 사용자가 패널을 닫은 뒤 방금
// 누른 자리를 잃지 않게 하기 위함(§C 접근성 기본 보강).
const panelTriggers = new WeakMap(); // panel -> 그 패널을 연 버튼

function openPanel(panel, trigger) {
  if (!panel) return;
  panel.hidden = false;
  if (trigger) panelTriggers.set(panel, trigger);
  // 패널이 열리면 포커스를 그 안(닫기 버튼)으로 옮긴다 — 키보드 사용자가
  // 패널이 열렸다는 걸 인지하고 바로 안에서 조작을 이어갈 수 있게.
  const closeBtn = panel.querySelector('.floating-panel-close');
  if (closeBtn) closeBtn.focus();
}

function closePanel(panel) {
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  const trigger = panelTriggers.get(panel);
  if (trigger && document.contains(trigger)) trigger.focus();
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
    const target = btn.dataset.panelTarget;
    openPanel(document.getElementById(target), btn);
    closeOsMenu();
    // §I/§L — 이 패널들은 열 때마다 최신 내용을 다시 불러온다(작업공간은
    // activeProject 폴더 구조, 프리셋은 저장된 목록, Git은 상태/커밋
    // 이력, 통계는 지금 캐시된 작업 기록 기준 집계).
    if (target === 'panel-workspace') loadWorkspaceTree('');
    if (target === 'panel-presets') loadPresets();
    if (target === 'panel-git') loadGitInfo();
    if (target === 'panel-stats') renderStats();
  });
});

settingsToggle.addEventListener('click', (event) => {
  event.stopPropagation();
  openPanel(settingsPanel, settingsToggle);
  closeOsMenu();
  loadPersonaForActiveProject();
  loadModelSetting();
});

// §L — 모델 선택. ⚠️ 설치된 Claude Code CLI가 --model 플래그와 이 값들을
// 실제로 지원하는지 실기기 검증 전이라, 기본은 "CLI 기본값"(플래그 자체를
// 안 붙임)이고 사용자가 명시적으로 고를 때만 지정된 모델로 넘어간다.
async function loadModelSetting() {
  const model = await window.caelus.getModel();
  modelSelect.value = model || '';
}

modelSelect.addEventListener('change', async () => {
  await window.caelus.setModel(modelSelect.value);
});

// ===================================================================
// §G — "나를 이렇게 대해줘" 페르소나(CLAUDE.md 마커 구간) 설정. 지금
// activeProject 기준으로 조회/저장한다 — 설정 패널을 열 때마다 그 시점의
// activeProject 내용으로 다시 불러온다.
// ===================================================================
let personaLoadToken = 0;
async function loadPersonaForActiveProject() {
  const token = ++personaLoadToken;
  personaProjectLabel.textContent = projectLabel(activeProject);
  personaStatus.textContent = '불러오는 중…';
  const text = await window.caelus.getPersona(activeProject);
  if (token !== personaLoadToken) return; // 그 사이 패널이 다시 열렸으면 낡은 응답은 버림
  personaInput.value = text;
  personaStatus.textContent = '';
}

personaSaveBtn.addEventListener('click', async () => {
  personaSaveBtn.disabled = true;
  personaStatus.textContent = '저장 중…';
  try {
    await window.caelus.setPersona(activeProject, personaInput.value);
    personaStatus.textContent = '저장됨';
  } catch (err) {
    personaStatus.textContent = '저장 실패';
    alert(err.message || String(err));
  } finally {
    personaSaveBtn.disabled = false;
    setTimeout(() => {
      if (personaStatus.textContent === '저장됨' || personaStatus.textContent === '저장 실패') {
        personaStatus.textContent = '';
      }
    }, 2000);
  }
});

// ===================================================================
// §I — 작업공간 패널을 실제 프로젝트 폴더 파일 트리로. 패널을 열 때(또는
// 프로젝트를 바꿔서 열 때) 그 프로젝트 폴더 내용을 보여주는 미니 파일
// 브라우저다 — 폴더를 클릭하면 안으로 들어가고(브레드크럼으로 위로 이동),
// 파일을 클릭하면 내용을 미리 본다.
// ===================================================================
let workspaceProject = null; // 지금 트리가 보여주고 있는 프로젝트(낡은 응답 감지용)
let workspacePath = ''; // 그 프로젝트 폴더 기준 상대 경로("" = 루트)

function renderWorkspaceBreadcrumb() {
  workspaceBreadcrumbEl.innerHTML = '';
  const rootBtn = document.createElement('button');
  rootBtn.type = 'button';
  rootBtn.className = 'workspace-crumb';
  rootBtn.textContent = projectLabel(activeProject);
  rootBtn.addEventListener('click', () => loadWorkspaceTree(''));
  workspaceBreadcrumbEl.appendChild(rootBtn);

  const segments = workspacePath ? workspacePath.split('/').filter(Boolean) : [];
  let acc = '';
  segments.forEach((seg) => {
    acc = acc ? `${acc}/${seg}` : seg;
    const targetPath = acc;
    const sep = document.createElement('span');
    sep.className = 'workspace-crumb-sep';
    sep.setAttribute('aria-hidden', 'true');
    sep.textContent = '/';
    workspaceBreadcrumbEl.appendChild(sep);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'workspace-crumb';
    btn.textContent = seg;
    btn.addEventListener('click', () => loadWorkspaceTree(targetPath));
    workspaceBreadcrumbEl.appendChild(btn);
  });
}

function hideWorkspacePreview() {
  workspacePreviewEl.hidden = true;
  workspacePreviewContentEl.textContent = '';
}

async function previewWorkspaceFile(relPath, name) {
  workspacePreviewEl.hidden = false;
  workspacePreviewNameEl.textContent = name;
  workspacePreviewContentEl.textContent = '불러오는 중…';
  const result = await window.caelus.readWorkspaceFile(activeProject, relPath);
  if (result.error) {
    workspacePreviewContentEl.textContent = result.error;
    return;
  }
  workspacePreviewContentEl.textContent =
    result.content + (result.truncated ? '\n\n… (파일이 커서 앞부분만 표시됨)' : '');
}

async function loadWorkspaceTree(relPath) {
  workspacePath = relPath || '';
  workspaceProject = activeProject;
  hideWorkspacePreview();
  renderWorkspaceBreadcrumb();
  workspaceTreeEl.innerHTML = '<div class="menu-recent-empty">불러오는 중…</div>';
  const result = await window.caelus.listWorkspaceFiles(activeProject, workspacePath);
  // 응답을 기다리는 사이 프로젝트가 바뀌었으면(다른 항목 클릭 등) 낡은
  // 목록으로 화면을 덮어쓰지 않는다.
  if (workspaceProject !== activeProject) return;
  workspaceTreeEl.innerHTML = '';
  if (result.entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'menu-recent-empty';
    empty.textContent = '비어 있는 폴더입니다.';
    workspaceTreeEl.appendChild(empty);
    return;
  }
  result.entries.forEach((entry) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'workspace-entry';
    row.setAttribute('role', 'listitem');
    row.innerHTML = `<span aria-hidden="true">${entry.isDir ? '📁' : '📄'}</span><span>${escapeHtml(entry.name)}</span>`;
    row.addEventListener('click', () => {
      const nextPath = workspacePath ? `${workspacePath}/${entry.name}` : entry.name;
      if (entry.isDir) loadWorkspaceTree(nextPath);
      else previewWorkspaceFile(nextPath, entry.name);
    });
    workspaceTreeEl.appendChild(row);
  });
}

workspacePreviewCloseBtn.addEventListener('click', hideWorkspacePreview);

// §L — 활성 프로젝트 폴더를 OS 탐색기로 열기(범위: 지금 activeProject
// 폴더 하나뿐 — §K에서 확인한 "좁은 범위 OS 연동"의 구체적 구현).
openExplorerBtn.addEventListener('click', async () => {
  const result = await window.caelus.openProjectFolder(activeProject);
  if (!result.opened) alert(result.reason || '폴더를 열지 못했습니다.');
});

// ===================================================================
// §I — 프롬프트 프리셋 관리 패널. 자주 쓰는 문구를 저장해뒀다가 클릭 한
// 번으로 입력창에 채워 넣는다. 프로젝트 구분 없이 전역으로 공유(store.js).
// ===================================================================
let presetsCache = [];
let editingPresetId = null; // 지금 편집 중인 프리셋 id(없으면 "새로 추가" 상태)

function resetPresetEditor() {
  editingPresetId = null;
  presetLabelInput.value = '';
  presetTextInput.value = '';
  presetAddBtn.textContent = '추가';
}

function renderPresetList() {
  presetListEl.innerHTML = '';
  if (presetsCache.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'menu-recent-empty';
    empty.textContent = '아직 저장된 프리셋이 없습니다.';
    presetListEl.appendChild(empty);
    return;
  }
  presetsCache.forEach((preset) => {
    const row = document.createElement('div');
    row.className = 'preset-row';
    row.innerHTML = `
      <button type="button" class="preset-use" title="입력창에 채우기">${escapeHtml(preset.label)}</button>
      <span class="preset-row-actions">
        <button type="button" class="tg-action preset-edit" title="편집" aria-label="'${escapeHtml(preset.label)}' 프리셋 편집">&#9998;</button>
        <button type="button" class="tg-action preset-delete" title="삭제" aria-label="'${escapeHtml(preset.label)}' 프리셋 삭제">&#128465;</button>
      </span>
    `;
    row.querySelector('.preset-use').addEventListener('click', () => {
      input.value = preset.text;
      input.focus();
    });
    row.querySelector('.preset-edit').addEventListener('click', () => {
      editingPresetId = preset.id;
      presetLabelInput.value = preset.label;
      presetTextInput.value = preset.text;
      presetAddBtn.textContent = '저장';
      presetLabelInput.focus();
    });
    row.querySelector('.preset-delete').addEventListener('click', async () => {
      if (!confirm(`'${preset.label}' 프리셋을 삭제할까요?`)) return;
      await window.caelus.deletePreset(preset.id);
      if (editingPresetId === preset.id) resetPresetEditor();
      await loadPresets();
    });
    presetListEl.appendChild(row);
  });
}

async function loadPresets() {
  presetsCache = await window.caelus.listPresets();
  renderPresetList();
}

presetAddBtn.addEventListener('click', async () => {
  const label = presetLabelInput.value.trim();
  const text = presetTextInput.value.trim();
  if (!label || !text) {
    alert('이름과 내용을 모두 입력해주세요.');
    return;
  }
  if (editingPresetId) {
    await window.caelus.updatePreset(editingPresetId, { label, text });
  } else {
    await window.caelus.addPreset(label, text);
  }
  resetPresetEditor();
  await loadPresets();
});

// ===================================================================
// §L — Git 패널(상태 요약 + 커밋 이력 + diff). §I의 코드 모드 자동
// 스냅샷이 쌓아둔 커밋들을 조회만 한다.
// ===================================================================
function hideGitDiff() {
  gitDiffEl.hidden = true;
  gitDiffContentEl.textContent = '';
}

async function showCommitDiff(hash, message) {
  gitDiffEl.hidden = false;
  gitDiffTitleEl.textContent = message;
  gitDiffContentEl.textContent = '불러오는 중…';
  const result = await window.caelus.getCommitDiff(activeProject, hash);
  gitDiffContentEl.textContent = result.error || result.diff || '(변경 내용 없음)';
}

async function loadGitInfo() {
  gitSummaryEl.textContent = '불러오는 중…';
  gitLogEl.innerHTML = '';
  hideGitDiff();

  const info = await window.caelus.getGitInfo(activeProject);
  if (!info.available) {
    gitSummaryEl.textContent = info.reason || '사용할 수 없습니다.';
    return;
  }

  gitSummaryEl.innerHTML = `
    <span class="git-branch">⎇ ${escapeHtml(info.branch)}</span>
    <span class="git-change-pill">수정 ${info.changes.modified}</span>
    <span class="git-change-pill">추가 ${info.changes.added}</span>
    <span class="git-change-pill">삭제 ${info.changes.deleted}</span>
    <span class="git-change-pill">추적 안 됨 ${info.changes.untracked}</span>
  `;

  if (info.commits.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'menu-recent-empty';
    empty.textContent = '아직 스냅샷 커밋이 없습니다(코딩 모드로 작업하면 자동으로 쌓입니다).';
    gitLogEl.appendChild(empty);
    return;
  }

  info.commits.forEach((commit) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'git-commit';
    btn.innerHTML = `
      <span class="git-commit-msg">${escapeHtml(commit.message)}</span>
      <span class="git-commit-meta">${escapeHtml(commit.hash)} · ${new Date(commit.date).toLocaleString('ko-KR')}</span>
    `;
    btn.addEventListener('click', () => showCommitDiff(commit.hash, commit.message));
    gitLogEl.appendChild(btn);
  });
}

gitDiffCloseBtn.addEventListener('click', hideGitDiff);

// ===================================================================
// §L — 로컬 사용 통계 패널. 새 데이터 수집 없이 이미 불러온
// allTasksCache(store.js의 tasks/logs)를 renderer에서 집계만 한다.
// ===================================================================
function renderStats() {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = todayStart - 6 * 24 * 60 * 60 * 1000; // 오늘 포함 최근 7일

  let todayCount = 0;
  let weekCount = 0;
  const byProject = new Map();

  allTasksCache.forEach((task) => {
    const created = new Date(task.created_at).getTime();
    if (created >= todayStart) todayCount += 1;
    if (created >= weekStart) weekCount += 1;
    const project = effectiveProject(task);
    byProject.set(project, (byProject.get(project) || 0) + 1);
  });

  statsSummaryEl.innerHTML = `
    <div><span>오늘</span><strong>${todayCount}</strong></div>
    <div><span>이번 주</span><strong>${weekCount}</strong></div>
    <div><span>전체</span><strong>${allTasksCache.length}</strong></div>
    <div><span>프로젝트</span><strong>${byProject.size}</strong></div>
  `;

  statsByProjectEl.innerHTML = '';
  if (byProject.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'menu-recent-empty';
    empty.textContent = '아직 활동 기록이 없습니다.';
    statsByProjectEl.appendChild(empty);
    return;
  }
  [...byProject.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([project, count]) => {
      const row = document.createElement('div');
      row.className = 'stats-project-row';
      row.innerHTML = `<span>${escapeHtml(projectLabel(project))}</span><span class="stats-count">${count}</span>`;
      statsByProjectEl.appendChild(row);
    });
}

// 메뉴 바깥을 클릭하면 드롭다운만 닫는다 — 이미 열어둔 패널들은 그대로
// 둔다(위젯이니까 다른 곳을 눌렀다고 사라지면 안 된다).
document.addEventListener('click', (event) => {
  if (!osMenuList.hidden && !event.target.closest('.os-menu')) {
    closeOsMenu();
  }
});

document.querySelectorAll('.floating-panel [data-close-panel]').forEach((closeBtn) => {
  closeBtn.addEventListener('click', () => {
    closePanel(closeBtn.closest('.floating-panel'));
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
  modeButtons.forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    // role="radio"(index.html)와 짝을 맞춰 스크린리더가 지금 선택된 모드를
    // 알 수 있게 한다 — .active 클래스는 시각적 표시일 뿐 접근성 트리에는
    // 안 잡힌다.
    btn.setAttribute('aria-checked', String(active));
  });
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
    parts.push({ type: 'code', content: match[2], lang: match[1] });
    lastIndex = fenceRegex.lastIndex;
  }
  if (lastIndex < text.length) parts.push({ type: 'text', content: text.slice(lastIndex) });

  return parts
    .map((part) => {
      if (part.type === 'code') {
        // §I — 코드 블록마다 "파일로 저장" 버튼을 붙인다. 스트리밍 중에는
        // setBubbleContent가 매 청크마다 innerHTML을 통째로 다시 그리므로,
        // 버튼에 직접 리스너를 매번 새로 다는 대신 conversation에 이벤트
        // 위임(delegation)으로 한 번만 걸어둔다(아래 conversation.addEventListener 참고).
        return (
          `<div class="code-block">` +
          `<button type="button" class="code-save-btn" data-lang="${escapeHtml(part.lang || '')}" title="이 코드를 프로젝트 폴더에 파일로 저장">파일로 저장</button>` +
          `<pre><code>${escapeHtml(part.content)}</code></pre>` +
          `</div>`
        );
      }
      return escapeHtml(part.content).replace(/`([^`\n]+)`/g, (_, code) => `<code>${code}</code>`);
    })
    .join('');
}

// ===================================================================
// 화면 단계(IDLE ↔ ACTIVE) — 대화가 없을 땐 AI 코어가 화면 중앙을 크게
// 차지하고, 첫 메시지가 오가는 순간 코어는 크기 그대로 왼쪽 칸으로 옮겨가고
// 오른쪽에 대화창이 나타나는 좌우 분할 레이아웃으로 바뀐다(코어가 작아져서
// 한쪽 구석에 작게 도킹되는 방식이 아니다). 실제 전환 애니메이션은
// styles.css의 body[data-ui-phase] 규칙(.main의 grid-template-columns
// 전환)이 전담하고, 여기서는 "지금 대화 내용이 있는가"라는 단 하나의 상태만
// body에 얹어준다 — addBubble/clearConversation이라는 기존의 단 두
// 지점에서만 호출되므로 대화가 생기고 사라지는 모든 경로(전송/스레드
// 보기/새 대화 시작/기록 삭제)에서 자동으로 같이 따라간다.
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
  // §J — Claude를 거치지 않고 로컬에서 바로 처리한 명령(프로젝트 전환 등)
  // 임을 시각적으로 구분하기 위한 role. 실제 응답과 헷갈리지 않도록 라벨을
  // 다르게 둔다.
  if (role === 'system') return { title: '시스템 알림', meta: 'LOCAL' };
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

  if (role !== 'user' && role !== 'system') {
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

// ===================================================================
// §I — 즐겨찾기(고정) 대화 스레드. store.js와 동일한 "project::threadId"
// 문자열 키 포맷을 그대로 써서, 백엔드가 어떤 스레드를 즐겨찾기로 보는지
// 렌더러가 별도 변환 없이 그대로 조회할 수 있게 한다.
// ===================================================================
let favoritesCache = new Set();

function favKey(project, threadId) {
  return `${project}::${threadId}`;
}

function isFavoriteThread(project, threadId) {
  if (!threadId) return false;
  return favoritesCache.has(favKey(project, threadId));
}

async function loadFavorites() {
  const list = await window.caelus.getFavorites();
  favoritesCache = new Set(list);
}

async function toggleFavoriteThread(project, threadId) {
  const result = await window.caelus.toggleFavorite(project, threadId);
  const key = favKey(project, threadId);
  if (result.favorited) favoritesCache.add(key);
  else favoritesCache.delete(key);
  renderHistoryTree(); // 별 아이콘 상태 + 즐겨찾기 섹션을 함께 다시 그림
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
  // 마우스로만 펼치기/접기가 되던 걸 키보드로도 할 수 있게(§C) — 포커스
  // 가능한 요소로 만들고 펼침 상태를 접근성 트리에도 노출한다.
  header.tabIndex = 0;
  header.setAttribute('role', 'button');
  header.setAttribute('aria-expanded', String(!collapsedGroups.has(project)));

  const isCollapsed = collapsedGroups.has(project);
  header.innerHTML = `
    <span class="tree-caret ${isCollapsed ? 'collapsed' : ''}">&#9662;</span>
    <span class="tree-group-name">${escapeHtml(projectLabel(project))}</span>
    <span class="tree-group-badge">${threadCount}</span>
    <span class="tree-group-actions">
      <button type="button" class="tg-action tg-new" title="이 프로젝트로 새 대화 시작" aria-label="'${escapeHtml(projectLabel(project))}' 프로젝트로 새 대화 시작">&#43;</button>
      ${project === DEFAULT_PROJECT_NAME ? '' : `
        <button type="button" class="tg-action tg-rename" title="이름변경" aria-label="'${escapeHtml(projectLabel(project))}' 이름변경">&#9998;</button>
        <button type="button" class="tg-action tg-delete" title="삭제" aria-label="'${escapeHtml(projectLabel(project))}' 프로젝트 삭제">&#128465;</button>
      `}
    </span>
  `;

  // 헤더 클릭(캐럿/이름 부분) = 펼치기/접기만. 화면(활성 프로젝트/대화창)은
  // 안 바뀐다 — 액션 버튼 영역 클릭은 여기서 걸러낸다(아래서 각각 처리).
  header.addEventListener('click', (event) => {
    if (event.target.closest('.tree-group-actions')) return;
    toggleGroupCollapsed(project);
  });
  // 키보드로도 같은 동작(Enter/Space) — 포커스가 액션 버튼 자체에 있을 때는
  // 그 버튼의 기본 동작(click)에 맡기고 여기서 가로채지 않는다.
  header.addEventListener('keydown', (event) => {
    if (event.target.closest('.tree-group-actions')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleGroupCollapsed(project);
    }
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
  // 마우스 전용이던 걸 키보드로도 열 수 있게(§C).
  li.tabIndex = 0;
  li.setAttribute('role', 'button');
  const modeLabel = MODE_LABEL[latest.mode] || latest.mode || '';
  const turns = threadTurnCount(threadEntry);
  const turnsLabel = turns > 1 ? ` · ${turns}턴` : '';
  const title = threadDisplayTitle(threadEntry);
  // 즐겨찾기(§I)는 진짜 이어지는 스레드(threadId가 있는 것)에만 의미가
  // 있다 — threadId가 없는 옛 1회성 기록은 별 버튼 자체를 안 보여준다.
  const favStarHtml = threadEntry.threadId
    ? `<button type="button" class="h-favorite ${isFavoriteThread(project, threadEntry.threadId) ? 'active' : ''}" title="즐겨찾기" aria-label="'${escapeHtml(title)}' 즐겨찾기 토글" aria-pressed="${isFavoriteThread(project, threadEntry.threadId)}">${isFavoriteThread(project, threadEntry.threadId) ? '&#9733;' : '&#9734;'}</button>`
    : '';
  li.innerHTML = `
    <div class="h-title">${escapeHtml(title)}</div>
    <div class="h-meta">${modeLabel} · ${latest.status} · ${new Date(latest.created_at).toLocaleString('ko-KR')}${turnsLabel}</div>
    ${favStarHtml}
    <button type="button" class="h-rename" title="제목 수정" aria-label="'${escapeHtml(title)}' 제목 수정">&#9998;</button>
    <button type="button" class="h-delete" title="삭제" aria-label="'${escapeHtml(title)}' 기록 삭제">&#10005;</button>
  `;
  li.addEventListener('click', (event) => {
    if (event.target.closest('.h-delete') || event.target.closest('.h-rename') || event.target.closest('.h-favorite')) return;
    viewThread(project, threadEntry);
  });
  li.addEventListener('keydown', (event) => {
    if (event.target.closest('.h-delete') || event.target.closest('.h-rename') || event.target.closest('.h-favorite')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      viewThread(project, threadEntry);
    }
  });
  const favBtn = li.querySelector('.h-favorite');
  if (favBtn) {
    favBtn.addEventListener('click', async (event) => {
      event.stopPropagation();
      await toggleFavoriteThread(project, threadEntry.threadId);
    });
  }
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

// §I — 전문 검색. 예전엔 제목(t.title)만 대상이었는데, 실제 응답 내용
// 안의 단어로는 못 찾는 문제가 있었다 — allTasksCache는 이미 각 task의
// logs(응답 본문)까지 다 갖고 있으므로(main.js의 caelus:get-history가
// store.getTasks()를 그대로 돌려줌) 그 안까지 검색 대상을 넓힌다.
function taskMatchesQuery(task, query) {
  if (task.title.toLowerCase().includes(query)) return true;
  return (task.logs || []).some((log) => log.content.toLowerCase().includes(query));
}

function renderSearchResults(query) {
  searchResultsEl.hidden = false;
  document.querySelectorAll('.tree-section-header').forEach((h) => (h.hidden = true));
  favoritesSectionEl.hidden = true;
  projectGroupsEl.hidden = true;
  generalGroupsEl.hidden = true;

  const filtered = allTasksCache.filter((t) => taskMatchesQuery(t, query));
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

// §I — 즐겨찾기한 스레드를 프로젝트 구분 없이 한 곳에 모아 맨 위에
// 보여준다(검색 결과와 같은 평평한 목록 + 프로젝트 태그 패턴 재사용).
// 즐겨찾기가 하나도 없으면 섹션 자체를 숨긴다.
function renderFavoritesSection() {
  const groups = buildThreadGroups(allTasksCache);
  const flatThreads = [];
  groups.forEach((threads, project) => {
    threads.forEach((entry) => {
      if (isFavoriteThread(project, entry.threadId)) flatThreads.push({ project, entry });
    });
  });

  favoritesListEl.innerHTML = '';
  favoritesSectionEl.hidden = flatThreads.length === 0;
  flatThreads
    .sort((a, b) => new Date(threadLatestTask(b.entry).created_at) - new Date(threadLatestTask(a.entry).created_at))
    .forEach(({ project, entry }) => {
      const li = makeThreadItem(project, entry);
      const tag = document.createElement('span');
      tag.className = 'h-project-tag';
      tag.textContent = projectLabel(project);
      li.querySelector('.h-meta').prepend(tag);
      favoritesListEl.appendChild(li);
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
  renderFavoritesSection();

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
      } else if (log.content.startsWith('[중단됨] ')) {
        // 취소된 요청 — 그때까지 스트리밍됐던 응답을 "중단됨" 표시와 함께
        // 그대로 보여준다(§M, main.js의 send-command catch 블록 참고).
        const bubble = addBubble('assistant', log.content.slice('[중단됨] '.length));
        bubble.el.classList.add('cancelled');
        const head = bubble.el.querySelector('.bubble-head');
        const titleEl = head && head.querySelector('strong');
        if (titleEl) {
          const badge = document.createElement('span');
          badge.className = 'bubble-cancelled-badge';
          badge.textContent = '중단됨';
          titleEl.after(badge);
        }
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
// 새 프로젝트 만들기 (+ §L 템플릿 선택)
// Electron은 window.prompt()를 지원하지 않는다(호출해도 다이얼로그가 안 뜨고
// 조용히 무시된다) — 화면에 직접 입력창을 보여주는 방식으로 처리한다.
// ===================================================================
function showNewProjectInput() {
  newProjectBtn.hidden = true;
  newProjectRow.hidden = false;
  newProjectInput.value = '';
  newProjectTemplate.value = '';
  newProjectInput.focus();
}

function hideNewProjectInput() {
  newProjectRow.hidden = true;
  newProjectBtn.hidden = false;
}

// 입력창과 템플릿 select를 한 묶음(newProjectRow)으로 취급한다 — select를
// 클릭하면 input이 blur되는데, 그걸 그냥 "바깥을 클릭했다"로 오인해서
// 숨겨버리면 템플릿을 고르자마자 입력창이 사라지는 버그가 생긴다. 포커스가
// 묶음 밖으로(relatedTarget이 newProjectRow 바깥) 나갈 때만 진짜로 닫는다.
function handleNewProjectBlur(event) {
  if (newProjectRow.contains(event.relatedTarget)) return;
  hideNewProjectInput();
}

newProjectBtn.addEventListener('click', showNewProjectInput);

async function submitNewProject() {
  const name = newProjectInput.value.trim();
  if (!name) {
    hideNewProjectInput();
    return;
  }
  const result = await window.caelus.createProject(name, newProjectTemplate.value || undefined);
  if (!result.created) {
    alert(result.reason || '폴더를 만들지 못했습니다.');
    return;
  }
  hideNewProjectInput();
  activeProject = result.name;
  await loadProjects();
  await loadHistory();
  refreshThreadStatus();
}

newProjectInput.addEventListener('keydown', async (event) => {
  if (event.key === 'Escape') {
    hideNewProjectInput();
    return;
  }
  if (event.key !== 'Enter') return;
  event.preventDefault();
  await submitNewProject();
});

newProjectInput.addEventListener('blur', handleNewProjectBlur);
newProjectTemplate.addEventListener('blur', handleNewProjectBlur);

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
  updateReassignSelect();
  return info;
}

// §L — 과거 스레드를 보고 있을 때만(재분류 대상이 명확할 때만) 다른
// 프로젝트로 옮기는 선택창을 보여준다.
function updateReassignSelect() {
  if (!viewingThread || !viewingThread.threadId) {
    reassignThreadSelect.hidden = true;
    return;
  }
  const otherProjects = projectsCache.filter((p) => p !== viewingThread.project);
  if (otherProjects.length === 0) {
    reassignThreadSelect.hidden = true;
    return;
  }
  reassignThreadSelect.innerHTML =
    '<option value="">다른 프로젝트로 이동…</option>' +
    otherProjects.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(projectLabel(p))}</option>`).join('');
  reassignThreadSelect.hidden = false;
}

reassignThreadSelect.addEventListener('change', async () => {
  const newProject = reassignThreadSelect.value;
  if (!newProject || !viewingThread) return;
  const { project: oldProject, threadId } = viewingThread;
  const result = await window.caelus.reassignThread(oldProject, threadId, newProject);
  if (!result.reassigned) {
    alert('이동하지 못했습니다.');
    reassignThreadSelect.value = '';
    return;
  }
  activeProject = newProject;
  viewingThread = { project: newProject, threadId };
  await loadFavorites(); // 즐겨찾기 키도 같이 옮겨졌을 수 있으니 다시 불러옴
  await loadHistory();
  await refreshThreadStatus();
});

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

// §L — 긴 대화를 요약해서 새 스레드로 이어간다: (1) 지금 스레드에 요약을
// 요청(--resume이라 전체 맥락을 보고 요약함), (2) 새 스레드로 전환,
// (3) 그 요약을 새 스레드의 첫 메시지로 보내 맥락을 이어간다. sendPrompt를
// 그대로 재사용하지 않는 이유: 요약 자체는 "재시도/취소" 같은 일반
// 메시지 흐름과 달리 그 결과 텍스트를 다음 단계(새 스레드 시작 메시지)에
// 다시 써야 해서 별도로 처리한다.
summarizeContinueBtn.addEventListener('click', async () => {
  if (isBusy) return;
  if (!confirm('지금까지의 대화를 요약하고, 그 요약으로 새 대화를 시작할까요?')) return;

  const summarizeRequest = '지금까지 나눈 대화 내용을 다음 대화에서 이어갈 수 있도록 핵심만 간결하게 요약해줘.';
  addBubble('user', summarizeRequest);
  setBusy(true);

  let summaryText = null;
  try {
    const result = await window.caelus.sendCommand(summarizeRequest, currentMode, activeProject);
    if (result.cancelled) {
      addBubble('error', '요약 요청이 취소됐습니다.');
      return;
    }
    summaryText = result.text;
    addBubble('assistant', summaryText);
  } catch (err) {
    addBubble('error', err.message || String(err));
    return;
  } finally {
    setBusy(false);
    await loadHistory();
    refreshThreadStatus();
  }

  if (!summaryText) return;

  // 새 스레드로 전환 — 지금까지 기록은 사이드바에 그대로 남는다.
  await window.caelus.startNewThread(activeProject);
  viewingThread = null;
  hideResumeBanner();
  clearConversation();
  await refreshThreadStatus();

  await sendPrompt(`(이전 대화 요약)\n${summaryText}\n\n위 내용을 참고해서 계속 진행해줘.`);
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
  // §L — 메시지 큐잉을 위해 입력창/전송 버튼은 busy 중에도 막지 않는다.
  // form submit 핸들러가 isBusy일 때 바로 보내지 않고 큐에 쌓는 식으로
  // 처리한다(아래 messageQueue 참고) — tg-rename/tg-delete/h-delete/
  // clearHistoryBtn처럼 store 상태를 직접 건드리는 액션들은 여전히
  // isBusy 체크로 따로 막혀 있다.
  cancelBtn.hidden = !busy;
  newThreadBtn.disabled = busy;
}

// §L — 메시지 큐잉: 응답 대기 중에 보낸 메시지를 순서대로 쌓아뒀다가
// 지금 요청이 끝나면 자동으로 이어서 보낸다.
let messageQueue = [];

function updateQueueIndicator() {
  queueIndicatorEl.textContent = messageQueue.length > 0 ? `${messageQueue.length}개 대기 중` : '';
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
  if (state === 'response' || state === 'error' || state === 'cancelled') {
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

// ===================================================================
// §I — 파일 첨부(드래그 앤 드롭). 창 어디에든(대화창이 비어있는 idle
// 상태에서도 동작해야 하므로 document.body 전체를) 파일을 끌어다 놓으면
// activeProject 폴더로 복사하고, 입력창에 그 경로를 적어 넣는다.
// ===================================================================
['dragenter', 'dragover'].forEach((eventName) => {
  document.body.addEventListener(eventName, (event) => {
    // 파일이 아니라 텍스트/링크 등을 끄는 중이면(예: 다른 앱에서 문장을
    // 드래그) 반응하지 않는다 — 순수 파일 드롭만 대상으로 한다.
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('Files')) return;
    event.preventDefault();
    document.body.classList.add('drag-over');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  document.body.addEventListener(eventName, (event) => {
    if (eventName === 'dragleave' && event.target !== document.body) return;
    document.body.classList.remove('drag-over');
  });
});

document.body.addEventListener('drop', async (event) => {
  const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
  if (files.length === 0) return;
  event.preventDefault();

  const imported = [];
  for (const file of files) {
    // Electron은 네이티브 OS 드래그로 들어온 File 객체에 실제 디스크 경로를
    // .path로 얹어준다(contextIsolation과 무관하게 동작하는 Electron 고유
    // 확장) — 그게 없으면(웹 컨텍스트 등 예외적 경우) 조용히 건너뛴다.
    if (!file.path) continue;
    const result = await window.caelus.importFile(activeProject, file.path);
    if (result.imported) {
      imported.push(result.relativePath);
    } else {
      alert(`'${file.name}' 첨부 실패: ${result.reason || '알 수 없는 오류'}`);
    }
  }
  if (imported.length > 0) {
    const mention = imported.map((p) => `[첨부파일: ${p}]`).join(' ');
    input.value = input.value ? `${input.value} ${mention}` : mention;
    input.focus();
  }
});

// §I — 코드 블록 "파일로 저장" 버튼. 스트리밍 중 setBubbleContent가 매
// 청크마다 .bubble-content의 innerHTML을 통째로 새로 그리기 때문에, 버튼
// 각각에 리스너를 직접 달면 스트리밍 도중 만들어진 코드 블록은 리스너가
// 못 붙는다 — conversation 하나에 이벤트 위임으로 걸어서 이 문제를 피한다.
conversation.addEventListener('click', async (event) => {
  const saveBtn = event.target.closest('.code-save-btn');
  if (!saveBtn) return;
  const codeEl = saveBtn.parentElement.querySelector('code');
  if (!codeEl) return;

  saveBtn.disabled = true;
  const originalLabel = '파일로 저장';
  try {
    const result = await window.caelus.saveCodeSnippet(activeProject, saveBtn.dataset.lang, codeEl.textContent);
    if (result.saved) {
      saveBtn.textContent = `저장됨: ${result.relativePath}`;
    } else {
      alert(result.reason || '저장하지 못했습니다.');
      saveBtn.textContent = originalLabel;
    }
  } finally {
    saveBtn.disabled = false;
    setTimeout(() => {
      saveBtn.textContent = originalLabel;
    }, 2500);
  }
});

// ===================================================================
// §M — 작업 정지 + 안전 종료: 급하게 나가야 할 때, 진행 중인 요청을 정리
// (취소 + 그때까지의 응답 저장)하고 나서 앱을 완전히 종료한다. 앱이 완전히
// 종료되면 그 순간부터 SSD를 물리적으로 뽑아도 안전하다.
// ===================================================================
async function waitUntilNotBusy(timeoutMs) {
  const start = Date.now();
  while (isBusy && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

safeQuitBtn.addEventListener('click', async () => {
  const message = isBusy
    ? '지금 하던 작업을 정리(취소 + 여기까지의 응답 저장)하고 CAELUS를 종료할까요?\n종료되면 SSD를 안전하게 분리할 수 있는 상태가 됩니다.'
    : 'CAELUS를 종료할까요?\n종료되면 SSD를 안전하게 분리할 수 있는 상태가 됩니다.';
  if (!confirm(message)) return;

  safeQuitBtn.disabled = true;

  if (isBusy && pendingTaskId) {
    // 취소만 요청하고 끝내면 안 된다 — form의 submit 핸들러가 sendCommand의
    // 결과(취소된 응답 저장 완료)를 받아 isBusy를 다시 false로 되돌릴 때까지
    // 기다려야, "저장하고 중단"이 실제로 끝난 뒤에 앱을 닫을 수 있다.
    safeQuitBtn.classList.add('busy');
    safeQuitBtn.title = '작업 정리 중… 곧 종료됩니다';
    await window.caelus.cancelCommand(pendingTaskId);
    await waitUntilNotBusy(15000);
  }

  await window.caelus.quitApp();
});

// ===================================================================
// §J — "OO 프로젝트 열어줘"류 문장을 Claude에 보내기 전에 로컬에서 먼저
// 처리한다. claude CLI는 텍스트만 주고받는 --print 모드라 CLI의 응답이
// CAELUS 앱 자체를 조작할 방법이 없다(도구 호출 연동 안 돼 있음) — 그래서
// "AI가 알아듣는" 게 아니라, 입력창 문구를 렌더러가 로컬 정규식으로 먼저
// 검사하는 방식으로 구현한다. 빠르고(Claude 호출 없이 즉시 반응), 비용도
// 안 들고, 오작동 위험도 낮다 — 정해진 패턴 + "실제로 존재하는 프로젝트
// 이름과 정확히 일치"할 때만 반응하고, 그 외엔 평소처럼 Claude에게 전송한다
// (오작동으로 일반 메시지를 삼켜버리지 않도록 안전하게 폴백).
const OPEN_PROJECT_PATTERN =
  /^(.+?)\s*(?:프로젝트)?\s*(?:을|를)?\s*(?:열어줘|불러와줘|보여줘|전환해줘|열어|열자)\.?$/;

// 문장이 "프로젝트 열기" 패턴과 일치하고, 추출한 이름이 실제 존재하는
// 프로젝트(대소문자/공백 무시)와 맞아떨어지면 그 프로젝트 이름을, 아니면
// null을 반환한다.
function matchProjectSwitchCommand(text) {
  const match = text.trim().match(OPEN_PROJECT_PATTERN);
  if (!match) return null;
  const rawName = match[1].trim();
  if (!rawName) return null;
  return projectsCache.find((name) => name.toLowerCase() === rawName.toLowerCase()) || null;
}

async function switchToProjectLocally(project) {
  // 사이드바에서 클릭했을 때와 같은 경로(viewThread)를 재사용해 그
  // 프로젝트의 가장 최근 스레드를 열어준다 — 없으면 그냥 새 대화 상태로.
  const groups = buildThreadGroups(allTasksCache);
  const threads = groups.get(project);
  if (threads && threads.size > 0) {
    const latestEntry = [...threads.values()].sort(
      (a, b) => new Date(threadLatestTask(b).created_at) - new Date(threadLatestTask(a).created_at)
    )[0];
    await viewThread(project, latestEntry);
  } else {
    activeProject = project;
    clearConversation();
    viewingThread = null;
    hideResumeBanner();
  }
  refreshThreadStatus();
  // 실제 Claude 응답이 아니라 로컬 처리라는 걸 시각적으로 구분해서 보여준다.
  addBubble('system', `✅ '${projectLabel(project)}' 프로젝트로 전환했습니다.`);
}

// §I — 실패한 메시지 재시도. form submit 핸들러 본문을 sendPrompt(text)로
// 빼서, "다시 시도" 버튼 클릭도 사용자가 다시 타이핑해서 전송한 것과
// 완전히 동일한 경로(같은 검증/스트리밍/취소/오류 처리)를 타게 한다.
async function sendPrompt(text) {
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
  setBusy(true);

  try {
    const result = await window.caelus.sendCommand(text, currentMode, activeProject);
    if (result.cancelled) {
      // 취소됨 — 스트리밍되던 말풍선을 지우지 않고 "중단됨" 표시만 덧붙인다
      // (§M "일시정지" 기능의 전제: 여기까지 답한 내용은 화면/기록 양쪽에
      // 그대로 남아야 한다).
      const bubble = pendingBubble || addBubble('assistant', '');
      setBubbleContent(bubble.contentEl, 'assistant', result.text || '(응답을 받기 전에 취소됨)');
      bubble.el.classList.add('cancelled');
      const head = bubble.el.querySelector('.bubble-head');
      const titleEl = head && head.querySelector('strong');
      if (titleEl && !head.querySelector('.bubble-cancelled-badge')) {
        const badge = document.createElement('span');
        badge.className = 'bubble-cancelled-badge';
        badge.textContent = '중단됨';
        titleEl.after(badge);
      }
    } else if (pendingBubble) {
      setBubbleContent(pendingBubble.contentEl, 'assistant', result.text);
    } else {
      addBubble('assistant', result.text);
    }
  } catch (err) {
    if (pendingBubble) pendingBubble.el.remove();
    const bubble = addBubble('error', err.message || String(err));
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'text-btn bubble-retry';
    retryBtn.textContent = '다시 시도';
    retryBtn.addEventListener('click', () => sendPrompt(text));
    bubble.el.appendChild(retryBtn);
  } finally {
    pendingBubble = null;
    pendingTaskId = null;
    setBusy(false);
    await loadHistory();
    refreshThreadStatus();
    // §L — 대기 중이던 다음 메시지가 있으면 자동으로 이어서 보낸다. await는
    // 안 한다 — 지금 이 sendPrompt 호출은 여기서 끝내고, 다음 메시지는
    // 독립된 새 호출로 진행(setBusy(false)가 이미 실행됐으므로 재진입
    // 가드에 안 걸림).
    if (messageQueue.length > 0) {
      const next = messageQueue.shift();
      updateQueueIndicator();
      sendPrompt(next);
    }
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) return;

  // 프로젝트 전환 명령은 큐잉 대상이 아니다 — Claude 호출 없이 즉시
  // 로컬에서 처리되므로, 응답 대기 중이어도 바로 실행한다(단, 화면을
  // 바꾸는 동작이라 진행 중인 요청과 뒤섞이지 않도록 isBusy면 무시).
  const switchTarget = matchProjectSwitchCommand(text);
  if (switchTarget) {
    if (isBusy) return;
    input.value = '';
    await switchToProjectLocally(switchTarget);
    return;
  }

  input.value = '';

  if (isBusy) {
    // §L — 메시지 큐잉: 응답 대기 중에도 입력을 막지 않고, 지금 요청이
    // 끝나면 자동으로 순서대로 보내지도록 쌓아둔다.
    messageQueue.push(text);
    updateQueueIndicator();
    return;
  }

  await sendPrompt(text);
});

// ===================================================================
// 단축키: Ctrl/Cmd+K로 기록 검색 포커스, Esc로 메뉴/패널 닫기 또는 취소
// 또는 입력창 비우기 (Enter 전송은 <input>의 기본 동작이라 별도 처리
// 불필요). 전에는 메뉴만 Esc로 닫혔고 .floating-panel은 ✕로만 닫을 수
// 있었는데(§C), 이제 열린 패널이 있으면 Esc로도 닫힌다 — 여러 개가 동시에
// 열려 있으면 한 번에 전부 닫는다.
// ===================================================================
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    historySearch.focus();
  }
  if (event.key === 'Escape') {
    const openPanels = document.querySelectorAll('.floating-panel:not([hidden])');
    if (!osMenuList.hidden) {
      closeOsMenu();
    } else if (openPanels.length > 0) {
      openPanels.forEach(closePanel);
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
  // 즐겨찾기는 loadHistory()가 트리를 그리기 전에 먼저 채워져 있어야
  // 첫 렌더링부터 별 아이콘 상태가 정확하다.
  await loadFavorites();
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
  // 전체화면 전환)만 다시 계산한다 — .jarvis-ring은 width/height가 고정값
  // (styles.css)이라 IDLE↔ACTIVE 전환으로 .main의 grid 배치가 바뀌어도
  // #ring 자신의 박스 크기는 그대로다(왼쪽 칸으로 위치만 옮겨갈 뿐, 코어가
  // 작아지지 않는다 — 맨 위 화면 단계 설명 참고). 그래서 이 전환에는 별도
  // resizeCanvas() 호출이 필요 없다.
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

// ===================================================================
// CAELUS Particle Core Visualizer
// 시각 효과 전용 코드입니다.
// 기존 Claude Code, IPC, 저장, 프로젝트, 대화 전송 로직은 건드리지 않습니다.
// ===================================================================
(function initCaelusParticleCore() {
  const ringEl = document.getElementById("ring");
  const canvas = document.getElementById("particle-core-canvas");

  if (!ringEl || !canvas || canvas.dataset.caelusParticleReady === "1") return;

  canvas.dataset.caelusParticleReady = "1";

  const ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  const reduceMotion = window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;

  const BLUE = {
    dot: "rgba(107, 238, 255, ",
    hot: "rgba(190, 252, 255, ",
    glow: "rgba(79, 214, 255, ",
  };

  const ORANGE = {
    dot: "rgba(255, 157, 74, ",
    hot: "rgba(255, 205, 123, ",
    error: "rgba(255, 92, 112, ",
    glow: "rgba(255, 139, 74, ",
  };

  let width = 0;
  let height = 0;
  let dpr = 1;
  let time = 0;
  let rafId = 0;
  let lastState = "idle";
  let responsePulse = 0;
  let resizeObserver = null;

  const coreParticles = [];
  const streamParticles = [];
  const dustParticles = [];

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function rgba(base, alpha) {
    return base + clamp(alpha, 0, 1) + ")";
  }

  function currentState() {
    if (ringEl.classList.contains("error")) return "error";
    if (ringEl.classList.contains("cancelled")) return "cancelled";
    if (ringEl.classList.contains("response")) return "response";
    if (ringEl.classList.contains("listening")) return "listening";
    return "idle";
  }

  function makeCoreParticle(group) {
    const blue = group === "blue";

    return {
      group,
      angle: rand(0, Math.PI * 2),
      radius: blue ? rand(14, 150) : rand(8, 90),
      orbitSpeed: blue ? rand(0.45, 1.25) : rand(0.65, 1.75),
      size: blue ? rand(0.72, 2.15) : rand(0.62, 1.9),
      alpha: blue ? rand(0.26, 0.92) : rand(0.22, 0.82),
      phase: rand(0, Math.PI * 2),
      wobble: rand(0.55, 2.65),
      drift: rand(-0.0012, 0.0012),
      spark: Math.random() > (blue ? 0.88 : 0.80),
    };
  }

  function makeStreamParticle() {
    return {
      k: Math.random(),
      speed: rand(0.0018, 0.008),
      size: rand(0.55, 1.7),
      offset: rand(-22, 22),
      phase: rand(0, Math.PI * 2),
      alpha: rand(0.18, 0.86),
    };
  }

  function makeDustParticle() {
    return {
      x: Math.random(),
      y: Math.random(),
      speed: rand(0.00015, 0.0008),
      size: rand(0.45, 1.2),
      alpha: rand(0.045, 0.18),
      phase: rand(0, Math.PI * 2),
    };
  }

  function seedParticles() {
    coreParticles.length = 0;
    streamParticles.length = 0;
    dustParticles.length = 0;

    for (let i = 0; i < 320; i += 1) {
      coreParticles.push(makeCoreParticle("blue"));
    }

    for (let i = 0; i < 190; i += 1) {
      coreParticles.push(makeCoreParticle("orange"));
    }

    for (let i = 0; i < 130; i += 1) {
      streamParticles.push(makeStreamParticle());
    }

    for (let i = 0; i < 90; i += 1) {
      dustParticles.push(makeDustParticle());
    }
  }

  function resize() {
    const rect = ringEl.getBoundingClientRect();

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(260, Math.floor(rect.width));
    height = Math.max(170, Math.floor(rect.height));

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = width + "px";
    canvas.style.height = height + "px";

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function drawPoint(x, y, radius, colorBase, alpha, bloom) {
    const a = clamp(alpha, 0, 1);

    if (bloom) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius * 7.5);
      g.addColorStop(0, rgba(colorBase, a * 0.38));
      g.addColorStop(0.38, rgba(colorBase, a * 0.10));
      g.addColorStop(1, rgba(colorBase, 0));

      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, radius * 7.5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = rgba(colorBase, a);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawGlow(cx, cy, radius, colorBase, alpha) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, rgba(colorBase, alpha));
    g.addColorStop(0.42, rgba(colorBase, alpha * 0.20));
    g.addColorStop(1, rgba(colorBase, 0));

    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawMinimalArc(cx, cy, radius, start, end, colorBase, alpha) {
    ctx.strokeStyle = rgba(colorBase, alpha);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();
  }

  function render() {
    const state = currentState();

    if (state !== lastState) {
      if (state === "response") responsePulse = 1;
      lastState = state;
    }

    const active = state === "listening";
    const error = state === "error";
    const cancelled = state === "cancelled";
    const response = state === "response";

    const speed = reduceMotion
      ? 0.18
      : active
        ? 2.75
        : error
          ? 2.1
          : cancelled
            ? 0.42
            : response
              ? 1.1
              : 0.72;

    const linkPower = active ? 1.0 : error ? 0.78 : response ? 0.4 : cancelled ? 0.08 : 0.16;
    const coreBoost = active ? 0.18 : response ? 0.08 : 0;
    const orangeBoost = error ? 0.26 : active ? 0.12 : cancelled ? 0.08 : 0;

    time += 0.0105 * speed;
    responsePulse = Math.max(0, responsePulse - 0.018);

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = "lighter";

    const blueCenter = {
      x: width * (width < 520 ? 0.60 : 0.62),
      y: height * 0.46,
    };

    const orangeCenter = {
      x: width * (width < 520 ? 0.36 : 0.35),
      y: height * 0.47,
    };

    const scale = Math.min(width / 760, height / 330);
    const blueRadius = 176 * scale;
    const orangeRadius = 106 * scale;

    drawGlow(
      blueCenter.x,
      blueCenter.y,
      blueRadius * 1.34,
      BLUE.glow,
      active ? 0.19 : 0.13
    );

    drawGlow(
      blueCenter.x,
      blueCenter.y,
      blueRadius * 0.55,
      BLUE.hot,
      active ? 0.12 : 0.08
    );

    drawGlow(
      orangeCenter.x,
      orangeCenter.y,
      orangeRadius * 1.45,
      error ? ORANGE.error : ORANGE.glow,
      error ? 0.20 : cancelled ? 0.08 : 0.12
    );

    for (const p of dustParticles) {
      p.x += p.speed * speed * 0.24;
      if (p.x > 1.03) p.x = -0.03;

      const x = p.x * width;
      const y = p.y * height + Math.sin(time * 0.7 + p.phase) * 5;

      drawPoint(x, y, p.size, BLUE.dot, p.alpha, false);
    }

    for (const s of streamParticles) {
      const streamSpeed = s.speed * (active ? 3.0 : error ? 2.2 : response ? 1.25 : 0.55);
      s.k = (s.k + streamSpeed) % 1;

      const k = s.k;
      const bend = Math.sin(k * Math.PI);
      const wave =
        Math.sin(k * Math.PI * 2 + time * 4.4 + s.phase) *
        (20 * scale + (active ? 6 : 0));

      const x = orangeCenter.x + (blueCenter.x - orangeCenter.x) * k;
      const y =
        orangeCenter.y +
        (blueCenter.y - orangeCenter.y) * k +
        wave +
        s.offset * bend * scale;

      const colorBase = k < 0.48 ? (error ? ORANGE.error : ORANGE.dot) : BLUE.dot;
      const fade = 0.14 + Math.sin(k * Math.PI) * 0.76;

      drawPoint(
        x,
        y,
        s.size * (active ? 1.28 : 1.0),
        colorBase,
        s.alpha * fade * linkPower,
        active && s.alpha > 0.52
      );
    }

    for (const p of coreParticles) {
      const blue = p.group === "blue";
      const center = blue ? blueCenter : orangeCenter;
      const groupScale = blue ? scale : scale * 0.96;

      const dir = blue ? 1 : -1;
      p.angle += dir * (0.00155 + p.orbitSpeed * 0.00125) * speed + p.drift;

      const rx = blue ? 1.16 : 1.32;
      const ry = blue ? 0.80 : 0.70;

      const breathe = Math.sin(time * p.wobble + p.phase) * (blue ? 9 : 14) * groupScale;
      const turbulence =
        Math.sin(time * 2.6 + p.phase) *
        (active ? (blue ? 9 : 14) : 2) *
        groupScale;

      const errorJitter =
        error && !blue ? Math.sin(time * 8 + p.phase) * 10 * groupScale : 0;

      const pulsePush =
        responsePulse * Math.sin(p.phase + time) * (blue ? 34 : 5) * groupScale;

      const r = p.radius * groupScale + breathe + turbulence + errorJitter + pulsePush;

      const x =
        center.x +
        Math.cos(p.angle) * r * rx +
        Math.sin(time * 1.2 + p.phase) * (blue ? 3 : 8) * groupScale;

      const y =
        center.y +
        Math.sin(p.angle) * r * ry +
        Math.cos(time * 1.1 + p.phase) * (blue ? 3 : 8) * groupScale;

      const coreDistance = clamp(1 - p.radius / (blue ? 170 : 105), 0, 1);

      const alpha =
        p.alpha +
        (blue ? coreBoost : orangeBoost) +
        coreDistance * (blue ? 0.12 : 0.08) +
        (p.spark && (active || error)
          ? 0.2 * Math.abs(Math.sin(time * 5 + p.phase))
          : 0);

      const base = blue
        ? p.spark
          ? BLUE.hot
          : BLUE.dot
        : error
          ? ORANGE.error
          : p.spark
            ? ORANGE.hot
            : ORANGE.dot;

      const size =
        p.size *
        groupScale *
        (1 + coreDistance * 0.32 + (active && p.spark ? 0.38 : 0));

      drawPoint(x, y, size, base, alpha, p.spark || coreDistance > 0.76);
    }

    ctx.globalCompositeOperation = "source-over";
    ctx.lineCap = "round";

    const arcAlpha = active ? 0.16 : error ? 0.12 : 0.065;

    for (let i = 0; i < 3; i += 1) {
      drawMinimalArc(
        blueCenter.x,
        blueCenter.y,
        (70 + i * 43 + Math.sin(time + i) * 5) * scale,
        Math.PI * (0.08 + i * 0.08),
        Math.PI * (1.42 + i * 0.04),
        BLUE.dot,
        arcAlpha
      );
    }

    for (let i = 0; i < 2; i += 1) {
      drawMinimalArc(
        orangeCenter.x,
        orangeCenter.y,
        (38 + i * 30 + Math.cos(time + i) * 3) * scale,
        Math.PI * (0.22 + i * 0.12),
        Math.PI * (1.20 + i * 0.12),
        error ? ORANGE.error : ORANGE.dot,
        error ? 0.17 : 0.075
      );
    }

    ctx.strokeStyle = error
      ? rgba(ORANGE.error, 0.105 * linkPower)
      : rgba(BLUE.dot, 0.075 * linkPower);

    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(orangeCenter.x + 50 * scale, orangeCenter.y);
    ctx.bezierCurveTo(
      width * 0.46,
      height * 0.34 + Math.sin(time) * 10,
      width * 0.50,
      height * 0.58 + Math.cos(time) * 10,
      blueCenter.x - 92 * scale,
      blueCenter.y
    );
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    rafId = window.requestAnimationFrame(render);
  }

  function start() {
    resize();
    seedParticles();

    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(ringEl);
    } else {
      window.addEventListener("resize", resize);
    }

    rafId = window.requestAnimationFrame(render);
  }

  window.addEventListener("beforeunload", () => {
    if (rafId) window.cancelAnimationFrame(rafId);

    if (resizeObserver) {
      resizeObserver.disconnect();
    } else {
      window.removeEventListener("resize", resize);
    }
  });

  start();
})();
