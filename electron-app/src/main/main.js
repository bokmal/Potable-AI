const { app, BrowserWindow, ipcMain, clipboard, dialog, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { ClaudeBridge, isResumeFailure } = require('./claudeBridge');
const { Store } = require('./store');
const { guardCredentials } = require('./credentialsGuard');

// 같은 PC에서 CAELUS가 중복 실행되는 것을 막는다. 자동실행 트리거가 걸린
// PC에서, 이전 창이 완전히 안 죽은 채로 USB가 재삽입되면 트리거가 또
// 발동해 두 번째 인스턴스가 뜰 수 있다 — 두 프로세스가 USB의 같은 JSON
// 저장소 파일에 동시에 쓰면 원자적 쓰기로도 못 막는 경합(레이스)이 생기므로
// 아예 두 번째 인스턴스를 못 뜨게 막는다. 이 락은 그 PC의 실제 Windows
// 프로필에 저장되므로(USB 안이 아님), PC마다 독립적으로 동작한다 — 여러
// PC에서 각자 CAELUS를 쓰는 정상적인 사용은 막지 않는다.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  return;
}

// USB_ROOT: electron-app/src/main 에서 세 단계 위 = CAELUS 루트 폴더.
const USB_ROOT = path.join(__dirname, '..', '..', '..');
const PROJECTS_DIR = path.join(USB_ROOT, 'projects');
const GIT_EXE = path.join(USB_ROOT, 'git', 'bin', 'git.exe');

// 프로젝트를 따로 안 고르고 하는 일반 대화/작업은 projects\ 바로 아래가
// 아니라 이 이름의 하위 폴더에 자동으로 모인다 — projects\ 루트 자체는
// 항상 폴더들만 담는 컨테이너로 남는다.
const DEFAULT_PROJECT_NAME = 'general';

let mainWindow;
const claude = new ClaudeBridge();
const store = new Store();

// 현재 진행 중인 요청 하나만 추적한다(동시에 여러 요청은 아직 지원하지
// 않음 — UI도 입력창을 잠가 한 번에 하나씩만 보내도록 되어 있다).
let activeChild = null;
let activeTaskId = null;

// child.kill()만으로는 부족할 수 있다 — Windows에서는 claudeBridge.js가
// shell:true로 띄우기 때문에 activeChild는 진짜 claude 프로세스가 아니라
// 그걸 감싼 cmd.exe다. child.kill()은 그 cmd.exe만 죽이고, 실제 작업 중이던
// claude/node 프로세스는 고아로 남아 파일을 계속 건드릴 수 있다("취소했는데
// 계속 수정됨" 시나리오). taskkill /t로 그 프로세스가 띄운 자식 트리 전체를
// 강제 종료한다. macOS/Linux는 shell:true를 안 쓰므로(claudeBridge.js 참고)
// activeChild가 곧 실제 claude 프로세스라 기존 kill()로 충분하다.
function killChildTree(child, callback) {
  if (!child) {
    if (callback) callback();
    return;
  }
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => {
      if (callback) callback();
    });
  } else {
    child.kill();
    if (callback) callback();
  }
}

// Claude Code CLI 로그인 세션이 USB가 뽑히는 도중 손상됐을 수 있으니, 매
// 실행마다 확인/백업한다 (자세한 설명은 credentialsGuard.js 참고).
guardCredentials(process.env.CAELUS_HOME);

app.on('second-instance', () => {
  // 이미 떠 있는 창을 앞으로 가져온다 — 두 번째 실행 시도는 조용히 무시.
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0b1220',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 요청 진행 중에 창을 닫아도(또는 OS가 앱을 종료시켜도) claude 프로세스가
// 백그라운드에 남지 않도록 한다. 종료를 한 번 가로채 실제로 프로세스가
// 죽는 걸 기다린 뒤(taskkill은 비동기) 다시 quit()을 호출 — 그냥 fire-and-
// forget으로 두면 Electron이 taskkill 콜백이 오기 전에 프로세스 자체를
// 먼저 종료해버려 kill 요청이 씹힐 수 있다.
let quitting = false;
app.on('before-quit', (event) => {
  if (activeChild && !quitting) {
    quitting = true;
    event.preventDefault();
    const child = activeChild;
    activeChild = null;
    killChildTree(child, () => app.quit());
  }
});

function send(event, channel, payload) {
  if (event && event.sender && !event.sender.isDestroyed()) {
    event.sender.send(channel, payload);
  }
}

// §I — 응답 완료 시 OS 알림. 사용자가 이미 CAELUS 창을 보고 있으면(포커스
// 있고 최소화도 안 됨) 화면에서 바로 확인되므로 알림까지 뜨면 오히려
// 방해된다 — 창이 최소화/비활성일 때만 울린다.
function notifyIfAway(title, body) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isFocused() && !mainWindow.isMinimized()) return;
  if (!Notification.isSupported()) return;
  try {
    new Notification({ title, body }).show();
  } catch {
    // 알림이 막힌 환경(OS 권한 등)이면 조용히 무시 — 핵심 기능이 아님
  }
}

// --- IPC: 작업 기록(세션/태스크) 조회 ---
ipcMain.handle('caelus:get-history', () => {
  return store.getTasks();
});

ipcMain.handle('caelus:get-task', (event, taskId) => {
  return store.getTask(taskId);
});

ipcMain.handle('caelus:delete-task', (event, taskId) => {
  store.deleteTask(taskId);
  return true;
});

ipcMain.handle('caelus:clear-history', () => {
  store.clearAll();
  return true;
});

// --- IPC: 실제 Claude 계정 사용량 페이지를 기본 브라우저로 열기 ---
// 세션(5시간)/주간 한도 %는 Claude 계정(구독 플랜) 자체의 정보라 CLI나 이
// 저장소 코드로는 조회할 공식적인 방법이 없다(실사용 중 확인됨,
// `claude --help`에 관련 명령 없음). 흉내내는 대신 진짜 페이지로 바로
// 연결해준다.
ipcMain.handle('caelus:open-usage-page', () => {
  shell.openExternal('https://claude.ai/settings/usage');
  return true;
});

// --- IPC: projects\ 하위 폴더 목록 (프로젝트 전환용) ---
// DEFAULT_PROJECT_NAME("general")은 항상 존재를 보장하고 목록 맨 앞에 둔다 —
// 프로젝트를 안 고른 일반 작업이 항상 그리로 모이기 때문에, 폴더 자체도
// 항상 있어야 한다(처음엔 없을 수 있으므로 여기서 만들어둔다).
ipcMain.handle('caelus:list-projects', () => {
  try {
    const generalDir = path.join(PROJECTS_DIR, DEFAULT_PROJECT_NAME);
    if (!fs.existsSync(generalDir)) fs.mkdirSync(generalDir, { recursive: true });

    const others = fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((n) => n !== DEFAULT_PROJECT_NAME)
      .sort((a, b) => a.localeCompare(b, 'ko'));

    return [DEFAULT_PROJECT_NAME, ...others];
  } catch (err) {
    console.error(`[CAELUS] projects 목록 조회 실패: ${err.message}`);
    return [DEFAULT_PROJECT_NAME];
  }
});

// 폴더 이름 하나가 PROJECTS_DIR 바로 아래의 안전한 경로로 귀결되는지만
// 검사한다(경로 구분자/".."로 바깥으로 못 나가게, Windows 금지 문자도
// 같이 거름). "이미 있는 폴더"/"general은 예약어" 같은 상황별 규칙은 이
// 함수 밖에서 따로 처리한다 — create/rename-project처럼 "general"을
// 막아야 하는 호출부와, send-command처럼 "general"도 정상값으로 취급해야
// 하는 호출부가 이 안전성 검사 하나를 같이 쓴다.
function safeProjectPath(trimmed) {
  if (/[\\/:*?"<>|]/.test(trimmed) || trimmed === '.' || trimmed === '..') return null;
  const target = path.join(PROJECTS_DIR, trimmed);
  // 위 필터를 통과하더라도 이중으로 확인한다 — 결과 경로가 반드시
  // PROJECTS_DIR 바로 아래여야 한다.
  if (path.dirname(target) !== PROJECTS_DIR) return null;
  return target;
}

// 프로젝트(폴더) 이름 하나가 새로 만들거나(생성) 바꾸려는(이름변경) 이름으로
// 유효한지 검사한다. create-project/rename-project가 공유한다.
// existingTarget: 검사 대상 자기 자신의 현재 경로(이름변경 시, "이미 있는
// 폴더" 체크에서 자기 자신은 예외로 치기 위해 필요) — 생성 시에는 생략.
function validateProjectName(trimmed, { existingTarget } = {}) {
  if (!trimmed) {
    return { ok: false, reason: '이름을 입력해주세요.' };
  }
  if (/[\\/:*?"<>|]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    return { ok: false, reason: '폴더 이름에 \\ / : * ? " < > | 는 쓸 수 없습니다.' };
  }
  if (trimmed.toLowerCase() === DEFAULT_PROJECT_NAME) {
    return { ok: false, reason: `'${DEFAULT_PROJECT_NAME}'은(는) 일반 작업용으로 예약된 이름입니다.` };
  }

  const target = safeProjectPath(trimmed);
  if (!target) {
    return { ok: false, reason: '잘못된 이름입니다.' };
  }
  if (fs.existsSync(target) && target !== existingTarget) {
    return { ok: false, reason: '이미 있는 폴더입니다.' };
  }

  return { ok: true, target };
}

// --- IPC: projects\ 아래에 새 폴더 만들기 ---
// §L — 새 프로젝트 템플릿. 빈 폴더 대신 선택한 스타터 구조로 초기화한다.
// template이 이 목록에 없으면(생략 포함) 지금까지처럼 빈 폴더 그대로 둔다.
const PROJECT_TEMPLATES = {
  node: {
    'package.json': `${JSON.stringify({ name: 'my-project', version: '1.0.0', main: 'index.js' }, null, 2)}\n`,
    'index.js': "console.log('Hello from CAELUS!');\n",
    '.gitignore': 'node_modules/\n',
  },
  python: {
    'main.py': "print('Hello from CAELUS!')\n",
    'requirements.txt': '',
  },
  static: {
    'index.html':
      '<!doctype html>\n<html>\n<head><meta charset="UTF-8"><title>My Site</title></head>\n<body>\n<h1>Hello from CAELUS!</h1>\n</body>\n</html>\n',
    'styles.css': 'body { font-family: sans-serif; }\n',
  },
};

ipcMain.handle('caelus:create-project', (event, name, template) => {
  const trimmed = String(name || '').trim();
  const check = validateProjectName(trimmed);
  if (!check.ok) return { created: false, reason: check.reason };

  try {
    fs.mkdirSync(check.target, { recursive: true });
    const files = PROJECT_TEMPLATES[template];
    if (files) {
      Object.entries(files).forEach(([filename, content]) => {
        fs.writeFileSync(path.join(check.target, filename), content, 'utf8');
      });
    }
    return { created: true, name: trimmed };
  } catch (err) {
    return { created: false, reason: err.message };
  }
});

// --- IPC: 프로젝트 폴더 이름변경 ---
// 실제 폴더 이름을 바꾸고(fs.renameSync), 그 프로젝트에 속한 기존 작업
// 기록(tasks)의 project 값과 활성 스레드 포인터도 같이 옮긴다 — 안 그러면
// 이름을 바꾼 순간 과거 기록이 옛 이름의 "사라진 프로젝트"로 남아 고아가 된다.
ipcMain.handle('caelus:rename-project', (event, oldName, newName) => {
  const from = String(oldName || '').trim();
  const to = String(newName || '').trim();
  if (!from || from === DEFAULT_PROJECT_NAME) {
    return { renamed: false, reason: '이 폴더는 이름을 바꿀 수 없습니다.' };
  }
  const fromPath = path.join(PROJECTS_DIR, from);
  if (path.dirname(fromPath) !== PROJECTS_DIR || !fs.existsSync(fromPath)) {
    return { renamed: false, reason: '대상 폴더를 찾을 수 없습니다.' };
  }
  const check = validateProjectName(to, { existingTarget: fromPath });
  if (!check.ok) return { renamed: false, reason: check.reason };

  try {
    fs.renameSync(fromPath, check.target);
    store.renameProjectInTasks(from, to);
    return { renamed: true, name: to };
  } catch (err) {
    return { renamed: false, reason: err.message };
  }
});

// --- IPC: 프로젝트 폴더 삭제 ---
// 파괴적 작업 — 그 폴더 안 실제 작업 파일까지 전부 영구 삭제된다. 렌더러
// 쪽에서 강한 확인 문구를 먼저 보여준 뒤에만 이 채널을 호출해야 한다.
// 대화 기록(tasks/logs) 자체는 지우지 않는다 — 사이드바에서 "일반"
// 그룹으로 자동 재배치되어 계속 보인다(고아 데이터 방지, 프로젝트 폴더
// 삭제 ≠ 그 프로젝트에서 나눈 대화 기억을 지우는 것).
ipcMain.handle('caelus:delete-project', (event, name) => {
  const trimmed = String(name || '').trim();
  if (!trimmed || trimmed === DEFAULT_PROJECT_NAME) {
    return { deleted: false, reason: '이 폴더는 삭제할 수 없습니다.' };
  }
  const target = path.join(PROJECTS_DIR, trimmed);
  if (path.dirname(target) !== PROJECTS_DIR) {
    return { deleted: false, reason: '잘못된 이름입니다.' };
  }
  if (!fs.existsSync(target)) {
    return { deleted: false, reason: '이미 없는 폴더입니다.' };
  }

  try {
    fs.rmSync(target, { recursive: true, force: true });
    store.clearActiveThread(trimmed);
    return { deleted: true };
  } catch (err) {
    return { deleted: false, reason: err.message };
  }
});

// --- IPC: "나를 이렇게 대해줘" 페르소나 설정(§G) ---
// Claude Code CLI는 작업 디렉터리의 CLAUDE.md를 실행마다 자동으로 읽어들이는
// 표준 동작이 있고, CAELUS는 이미 매 요청마다 cwd를 그 프로젝트의 실제
// 폴더(projects\<name>\)로 지정해서 claude를 실행한다(위 send-command 참고).
// 그래서 프로젝트 폴더 안에 CLAUDE.md를 두면 "사람이 매번 다시 말하는 대신"
// CLI가 매 실행마다 다시 읽어가는 방식으로 "기억하는 것처럼" 동작할 수
// 있다. CLAUDE.md가 이미 사용자의 다른 용도(프로젝트 문서 등)로 존재할 수
// 있으므로, 완전히 덮어쓰지 않고 CAELUS가 관리하는 구간만 마커 주석으로
// 감싸 그 부분만 갱신한다.
//
// ⚠️ 실기기 검증 필요: 이 앱의 --print 비대화형 실행 경로에서도 CLI가 실제로
// CLAUDE.md를 반영하는지는 아직 확인되지 않았다(문서화된 표준 동작이라는
// 것만 확인됨) — 실기기에서 문구를 저장한 뒤 실제 대화에 반영되는지 확인
// 필요.
const PERSONA_START = '<!-- CAELUS PERSONA START -->';
const PERSONA_END = '<!-- CAELUS PERSONA END -->';

function personaFilePath(project) {
  const targetProject = project || DEFAULT_PROJECT_NAME;
  const dir = targetProject === DEFAULT_PROJECT_NAME
    ? path.join(PROJECTS_DIR, DEFAULT_PROJECT_NAME)
    : safeProjectPath(targetProject);
  if (!dir) return null;
  return path.join(dir, 'CLAUDE.md');
}

ipcMain.handle('caelus:get-persona', (event, project) => {
  const filePath = personaFilePath(project);
  if (!filePath || !fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf8');
  const startIdx = content.indexOf(PERSONA_START);
  const endIdx = content.indexOf(PERSONA_END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return '';
  return content.slice(startIdx + PERSONA_START.length, endIdx).trim();
});

ipcMain.handle('caelus:set-persona', (event, project, text) => {
  const filePath = personaFilePath(project);
  if (!filePath) throw new Error('잘못된 프로젝트입니다.');

  const trimmed = String(text || '').trim();
  let content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const startIdx = content.indexOf(PERSONA_START);
  const endIdx = content.indexOf(PERSONA_END);
  const hasMarkers = startIdx !== -1 && endIdx !== -1 && endIdx > startIdx;

  if (!trimmed) {
    // 비워서 저장 = 페르소나 삭제. 마커 구간만 제거하고 그 밖의(사용자가
    // 직접 넣어뒀을 수 있는) 내용은 그대로 둔다. 마커가 원래 없었으면
    // 파일 자체를 새로 만들지 않는다(빈 CLAUDE.md를 만들어두지 않기 위함).
    if (hasMarkers) {
      const stripped = (
        content.slice(0, startIdx) + content.slice(endIdx + PERSONA_END.length)
      ).replace(/\n{3,}/g, '\n\n');
      fs.writeFileSync(filePath, stripped, 'utf8');
    }
    return { saved: true };
  }

  const block = `${PERSONA_START}\n${trimmed}\n${PERSONA_END}`;
  if (hasMarkers) {
    content = content.slice(0, startIdx) + block + content.slice(endIdx + PERSONA_END.length);
  } else if (content.trim().length > 0) {
    content = content.replace(/\s*$/, '') + '\n\n' + block + '\n';
  } else {
    content = block + '\n';
  }

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return { saved: true };
});

// --- IPC: 대화 스레드 연속성 ---
ipcMain.handle('caelus:get-thread-info', (event, project) => {
  return store.getThreadInfo(project || DEFAULT_PROJECT_NAME);
});

// "새 대화 시작" — 그 프로젝트의 활성 스레드 포인터만 지운다. 지금까지
// 쌓인 tasks/logs(과거 기록)는 그대로 남는다.
ipcMain.handle('caelus:new-thread', (event, project) => {
  store.clearActiveThread(project || DEFAULT_PROJECT_NAME);
  return store.getThreadInfo(project || DEFAULT_PROJECT_NAME);
});

// "이어서 대화하기" — 과거 기록에서 본 스레드를 그 프로젝트의 활성 스레드로
// 다시 지정한다. 이미 활성 스레드였어도 멱등이라 그냥 덮어써도 안전하다.
ipcMain.handle('caelus:resume-thread', (event, project, threadId) => {
  const p = project || DEFAULT_PROJECT_NAME;
  if (threadId) store.setActiveThread(p, threadId);
  return store.getThreadInfo(p);
});

ipcMain.handle('caelus:rename-task', (event, taskId, newTitle) => {
  return { renamed: store.renameTask(taskId, newTitle) };
});

// §L — 대화 스레드를 다른 프로젝트로 재분류.
ipcMain.handle('caelus:reassign-thread', (event, oldProject, threadId, newProject) => {
  return { reassigned: store.reassignThreadProject(oldProject, threadId, newProject) };
});

// §L — 활성 프로젝트 폴더를 OS 탐색기로 열기. §K에서 확인한 "좁은 범위
// OS 연동은 안전하게 추가 가능"의 구체적 구현 — 지금 활성화된 프로젝트
// 폴더 하나로만 범위를 좁힌다(임의 경로를 열 방법은 없음).
ipcMain.handle('caelus:open-project-folder', async (event, project) => {
  const dir = projectDir(project);
  if (!dir) return { opened: false, reason: '잘못된 프로젝트입니다.' };
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const result = await shell.openPath(dir);
  // shell.openPath는 성공하면 빈 문자열을, 실패하면 에러 메시지를 반환한다.
  return result ? { opened: false, reason: result } : { opened: true };
});

// --- IPC: 작업공간 파일 트리(§I) ---
// #panel-workspace를 activeProject와 무관한 장식용 정적 텍스트가 아니라
// 실제 프로젝트 폴더 구조를 보여주는 미니 파일 브라우저로 만든다.
function projectDir(project) {
  const targetProject = project || DEFAULT_PROJECT_NAME;
  return targetProject === DEFAULT_PROJECT_NAME
    ? path.join(PROJECTS_DIR, DEFAULT_PROJECT_NAME)
    : safeProjectPath(targetProject);
}

// relPath가 그 프로젝트 폴더 밖으로 못 나가게 막는다(../ 등으로 상위
// 디렉터리를 벗어나는 경로 탈출 방지) — send-command의 cwd 검증과 같은
// 이유의 방어 종심.
function safeWorkspacePath(project, relPath) {
  const base = projectDir(project);
  if (!base) return null;
  const rel = String(relPath || '').replace(/^[/\\]+/, '');
  const target = path.join(base, rel);
  const normalizedBase = path.normalize(base);
  if (target !== normalizedBase && !target.startsWith(normalizedBase + path.sep)) return null;
  return target;
}

ipcMain.handle('caelus:list-workspace-files', (event, project, relPath) => {
  const dirPath = safeWorkspacePath(project, relPath);
  if (!dirPath || !fs.existsSync(dirPath)) return { entries: [], path: relPath || '' };
  let stat;
  try {
    stat = fs.statSync(dirPath);
  } catch {
    return { entries: [], path: relPath || '' };
  }
  if (!stat.isDirectory()) return { entries: [], path: relPath || '' };
  const names = fs.readdirSync(dirPath, { withFileTypes: true });
  const entries = names
    .filter((d) => !d.name.startsWith('.')) // 숨김 파일/폴더는 목록을 어지럽히지 않게 제외
    .map((d) => ({ name: d.name, isDir: d.isDirectory() }))
    .sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
  return { entries, path: relPath || '' };
});

const WORKSPACE_PREVIEW_MAX_BYTES = 200 * 1024; // 미리보기 용도라 넉넉히 200KB까지만

ipcMain.handle('caelus:read-workspace-file', (event, project, relPath) => {
  const filePath = safeWorkspacePath(project, relPath);
  if (!filePath || !fs.existsSync(filePath)) {
    return { content: '', truncated: false, error: '파일을 찾을 수 없습니다.' };
  }
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    return { content: '', truncated: false, error: '폴더입니다.' };
  }
  if (stat.size > WORKSPACE_PREVIEW_MAX_BYTES * 4) {
    return { content: '', truncated: false, error: '파일이 너무 커서 미리볼 수 없습니다.' };
  }
  const buffer = fs.readFileSync(filePath);
  const truncated = buffer.length > WORKSPACE_PREVIEW_MAX_BYTES;
  const slice = truncated ? buffer.subarray(0, WORKSPACE_PREVIEW_MAX_BYTES) : buffer;
  // 텍스트인지 이진 파일인지 간단히 판별한다(null 바이트 포함 여부) — 이미지/
  // 실행 파일 등을 텍스트로 깨뜨려 보여주지 않기 위한 최소한의 안전장치.
  if (slice.includes(0)) {
    return { content: '', truncated: false, error: '텍스트로 미리볼 수 없는 파일입니다(바이너리).' };
  }
  return { content: slice.toString('utf8'), truncated, error: null };
});

// §I — Claude 응답의 코드 블록을 "파일로 저장" 버튼으로 프로젝트 폴더에
// 기록한다. 실제 프로젝트 파일과 섞이지 않도록 전용 하위 폴더
// (caelus-snippets\)에 모아둔다 — 사용자가 원하면 위 작업공간 패널에서
// 그대로 찾아볼 수 있다.
const LANG_EXT_MAP = {
  js: 'js', javascript: 'js', jsx: 'jsx', ts: 'ts', typescript: 'ts', tsx: 'tsx',
  py: 'py', python: 'py', html: 'html', css: 'css', json: 'json',
  md: 'md', markdown: 'md', sh: 'sh', bash: 'sh', shell: 'sh',
  java: 'java', c: 'c', cpp: 'cpp', 'c++': 'cpp', go: 'go',
  rust: 'rs', rs: 'rs', ruby: 'rb', rb: 'rb', php: 'php', sql: 'sql', yaml: 'yml', yml: 'yml',
};

ipcMain.handle('caelus:save-code-snippet', (event, project, lang, content) => {
  const dir = projectDir(project);
  if (!dir) return { saved: false, reason: '잘못된 프로젝트입니다.' };
  const snippetsDir = path.join(dir, 'caelus-snippets');
  try {
    if (!fs.existsSync(snippetsDir)) fs.mkdirSync(snippetsDir, { recursive: true });
    const ext = LANG_EXT_MAP[String(lang || '').toLowerCase()] || 'txt';
    const filename = `snippet-${Date.now()}.${ext}`;
    fs.writeFileSync(path.join(snippetsDir, filename), String(content || ''), 'utf8');
    return { saved: true, relativePath: `caelus-snippets/${filename}` };
  } catch (err) {
    return { saved: false, reason: err.message };
  }
});

// §I — 파일 첨부(드래그 앤 드롭). claude CLI는 텍스트만 주고받는 --print
// 모드라 파일 자체를 직접 받을 방법이 없다 — 그래서 끌어놓은 파일을 실제로
// activeProject 폴더(claudeBridge.js가 매번 cwd로 지정하는 바로 그 폴더)
// 안에 복사해두고, 렌더러가 입력창에 그 경로를 적어 넣어 프롬프트로
// 참조하게 하는 방식으로 구현한다.
const MAX_IMPORT_BYTES = 50 * 1024 * 1024; // 실수로 거대한 파일을 끌어놔도 USB 용량을 순식간에 잡아먹지 않게

ipcMain.handle('caelus:import-file', (event, project, sourcePath) => {
  const dir = projectDir(project);
  if (!dir) return { imported: false, reason: '잘못된 프로젝트입니다.' };
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { imported: false, reason: '파일을 찾을 수 없습니다.' };
  }
  const stat = fs.statSync(sourcePath);
  if (!stat.isFile()) return { imported: false, reason: '폴더는 첨부할 수 없습니다.' };
  if (stat.size > MAX_IMPORT_BYTES) return { imported: false, reason: '파일이 너무 큽니다(50MB 제한).' };

  // 파일명에 경로 문자가 섞여 있으면(드문 경우) 프로젝트 폴더 밖을
  // 가리키는 이름이 될 수 있으므로 제거한다 — safeProjectPath와 같은 이유.
  const baseName = path.basename(sourcePath).replace(/[\\/:*?"<>|]/g, '_');
  let targetName = baseName;
  let counter = 1;
  while (fs.existsSync(path.join(dir, targetName))) {
    const ext = path.extname(baseName);
    const stem = path.basename(baseName, ext);
    targetName = `${stem}-${counter}${ext}`;
    counter += 1;
  }
  try {
    fs.copyFileSync(sourcePath, path.join(dir, targetName));
    return { imported: true, relativePath: targetName };
  } catch (err) {
    return { imported: false, reason: err.message };
  }
});

// --- IPC: Git 상태/로그 + diff 뷰어(§L) ---
// Portable Git(GIT_EXE)이 이미 번들돼 있고, §I의 코드 모드 자동 스냅샷이
// 매 code 모드 요청 직전 커밋을 쌓아두므로, 여기서는 그 이력을 조회만
// 한다 — 지금까지 Claude한테 텍스트로 물어봐야만 알 수 있던 브랜치/변경
// 파일/최근 커밋을 패널로 바로 보여준다.
function runGit(cwd, args) {
  return new Promise((resolve) => {
    execFile(GIT_EXE, args, { cwd, timeout: 15000, maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ err, stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

ipcMain.handle('caelus:get-git-info', async (event, project) => {
  const dir = projectDir(project);
  if (!dir) return { available: false, reason: '잘못된 프로젝트입니다.' };
  if (!fs.existsSync(GIT_EXE)) return { available: false, reason: 'git을 찾을 수 없습니다.' };
  if (!fs.existsSync(path.join(dir, '.git'))) {
    return {
      available: false,
      reason: '이 프로젝트는 아직 git 저장소가 아닙니다. 코딩 모드로 한 번 이상 작업하면 자동으로 만들어집니다.',
    };
  }

  const branchResult = await runGit(dir, ['branch', '--show-current']);
  const branch = branchResult.stdout.trim() || '(브랜치 없음)';

  const statusResult = await runGit(dir, ['status', '--porcelain']);
  const statusLines = statusResult.stdout.split('\n').filter(Boolean);
  const changes = { modified: 0, added: 0, deleted: 0, untracked: 0 };
  statusLines.forEach((line) => {
    const code = line.slice(0, 2);
    if (code.includes('?')) changes.untracked += 1;
    else if (code.includes('A')) changes.added += 1;
    else if (code.includes('D')) changes.deleted += 1;
    else changes.modified += 1;
  });

  // \x1f(단위 구분자)로 필드를 나눈다 — 커밋 메시지 안에 콤마/파이프가
  // 섞여도 안전하게 쪼갤 수 있도록.
  const logResult = await runGit(dir, ['log', '-30', '--pretty=format:%h\x1f%s\x1f%ad', '--date=iso-strict']);
  const commits = logResult.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, message, date] = line.split('\x1f');
      return { hash, message, date };
    });

  return { available: true, branch, changes, commits };
});

ipcMain.handle('caelus:get-commit-diff', async (event, project, hash) => {
  const dir = projectDir(project);
  if (!dir || !fs.existsSync(GIT_EXE)) return { diff: '', error: '사용할 수 없습니다.' };
  if (!/^[0-9a-f]{4,40}$/i.test(String(hash || ''))) return { diff: '', error: '잘못된 커밋입니다.' };
  const result = await runGit(dir, ['show', hash, '--pretty=format:', '--no-color']);
  if (result.err) return { diff: '', error: result.stderr.trim() || result.err.message };
  // 아주 큰 diff는 미리보기 용도로 잘라서 반환한다(패널 렌더링 부담 방지).
  const MAX_DIFF_CHARS = 200000;
  const truncated = result.stdout.length > MAX_DIFF_CHARS;
  return {
    diff: result.stdout.slice(0, MAX_DIFF_CHARS) + (truncated ? '\n\n… (너무 커서 일부만 표시됨)' : ''),
    error: null,
  };
});

// --- IPC: 프롬프트 프리셋(§I) ---
ipcMain.handle('caelus:list-presets', () => store.getPresets());
ipcMain.handle('caelus:add-preset', (event, label, text) => store.addPreset(label, text));
ipcMain.handle('caelus:update-preset', (event, id, fields) => ({ updated: store.updatePreset(id, fields) }));
ipcMain.handle('caelus:delete-preset', (event, id) => ({ deleted: store.deletePreset(id) }));

// --- IPC: 즐겨찾기(고정) 대화 스레드(§I) ---
ipcMain.handle('caelus:get-favorites', () => store.getFavorites());
ipcMain.handle('caelus:toggle-favorite', (event, project, threadId) => ({
  favorited: store.toggleFavorite(project, threadId),
}));

// --- IPC: 모델 선택(§L) ---
ipcMain.handle('caelus:get-model', () => store.getModel());
ipcMain.handle('caelus:set-model', (event, model) => store.setModel(model));

// --- IPC: 클립보드 복사 ---
ipcMain.handle('caelus:copy-text', (event, text) => {
  clipboard.writeText(String(text ?? ''));
  return true;
});

// --- IPC: 대화 내보내기 (저장 대화상자 + 파일 쓰기) ---
ipcMain.handle('caelus:export-conversation', async (event, { content, suggestedName }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'CAELUS 대화 내보내기',
    defaultPath: suggestedName || 'caelus-conversation.md',
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: '텍스트', extensions: ['txt'] },
      { name: '모든 파일', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return { saved: false };
  fs.writeFileSync(result.filePath, content, 'utf8');
  return { saved: true, filePath: result.filePath };
});

// §I — 코딩 모드 실행 직전 프로젝트 폴더 스냅샷. Claude가 code 모드에서
// 파일을 고치기 시작하면 "되돌리기" 수단이 지금까지 전혀 없었다 — Portable
// Git(GIT_EXE)이 이미 번들돼 있으므로, 그 폴더를(아직 아니라면) git
// 저장소로 만들고 매 code 모드 요청 직전에 현재 상태를 커밋해둔다. 이렇게
// 쌓인 이력이면 사용자가 언제든 그 시점으로 git으로 되돌릴 수 있다(§L의
// diff 뷰어가 이 커밋들을 활용할 예정).
//
// 순전히 최선 노력(best-effort) 안전망이다 — git이 없거나, 아직 초기
// 커밋할 게 없거나(빈 폴더), 커밋할 변경사항이 없으면(직전 스냅샷과
// 동일) 전부 조용히 넘어간다. 실패해도 code 모드 요청 자체를 막지 않는다
// (스냅샷은 부가 기능이지 필수 전제조건이 아니다).
function snapshotProjectBeforeCodeMode(cwd) {
  return new Promise((resolve) => {
    if (!fs.existsSync(GIT_EXE)) {
      resolve();
      return;
    }
    const opts = { cwd, timeout: 15000 };
    const gitDir = path.join(cwd, '.git');
    const commitSnapshot = () => {
      execFile(GIT_EXE, ['add', '-A'], opts, () => {
        const message = `[CAELUS] 코드 작업 전 스냅샷 - ${new Date().toISOString()}`;
        // 이 저장소에만 적용되는 커밋 작성자 정보를 인라인으로 넘긴다(-c) —
        // USB를 꽂은 PC의 전역 git 설정(user.name/user.email)이 없어도
        // 커밋이 실패하지 않게 하기 위함이며, 다른 어떤 전역 설정도
        // 건드리지 않는다.
        execFile(
          GIT_EXE,
          ['-c', 'user.name=CAELUS', '-c', 'user.email=caelus@local', 'commit', '-m', message, '--quiet'],
          opts,
          () => resolve() // 커밋할 변경사항이 없어 실패하는 게 정상적인 대부분의 경우 — 조용히 진행
        );
      });
    };
    if (fs.existsSync(gitDir)) {
      commitSnapshot();
    } else {
      execFile(GIT_EXE, ['init', '--quiet'], opts, (err) => {
        if (err) {
          resolve(); // init조차 실패하면(권한 등) 스냅샷은 포기하고 요청은 계속 진행
          return;
        }
        commitSnapshot();
      });
    }
  });
}

// --- IPC: 이 저장소(USB)에 새 커밋이 있는지 확인 (자동으로 pull 하지는 않음) ---
ipcMain.handle('caelus:check-update', () => {
  return new Promise((resolve) => {
    if (!fs.existsSync(GIT_EXE)) {
      resolve({ checked: false, reason: 'git 없음' });
      return;
    }
    const opts = { cwd: USB_ROOT, timeout: 15000 };
    execFile(GIT_EXE, ['fetch', '--quiet'], opts, (fetchErr) => {
      if (fetchErr) {
        // 오프라인이거나 프록시 차단 등 — 조용히 실패 처리(사용자를 방해하지 않음)
        resolve({ checked: false, reason: fetchErr.message });
        return;
      }
      execFile(
        GIT_EXE,
        ['rev-list', '--count', 'HEAD..@{u}'],
        opts,
        (countErr, stdout) => {
          if (countErr) {
            resolve({ checked: false, reason: countErr.message });
            return;
          }
          const behind = parseInt(String(stdout).trim(), 10) || 0;
          resolve({ checked: true, updateAvailable: behind > 0, commitsBehind: behind });
        }
      );
    });
  });
});

// --- IPC: 안전 종료(§M) — 렌더러가 진행 중이던 요청을 취소하고 결과를
// 기다린 뒤 호출한다. app.quit()은 위 before-quit 훅을 거치므로, 혹시
// activeChild가 아직 안 지워졌어도(방어적으로) 한 번 더 안전하게 정리된다.
ipcMain.handle('caelus:quit-app', () => {
  app.quit();
  return true;
});

// --- IPC: 진행 중인 요청 취소 ---
ipcMain.handle('caelus:cancel-command', (event, taskId) => {
  if (activeChild && activeTaskId === taskId) {
    activeChild.emit('caelus:cancelled');
    killChildTree(activeChild);
    return true;
  }
  return false;
});

// --- IPC: 명령 전송 → Claude Code CLI 호출 ---
// UI 상태 전이: listening(입력 처리 중) → response(완료) / error(오류)
// mode: 'chat'(기본, 대화체) | 'code'(CLI 기본 동작 — 신중한 코딩 에이전트)
// projectName: projects\<projectName> 을 작업 디렉터리로 사용(선택). 안
// 고르면 projects\general\ 로 자동으로 모인다 — projects\ 루트 자체를
// cwd로 쓰지 않는다(예전엔 그렇게 했었는데, 그러면 프로젝트로 묶이지 않은
// 파일들이 루트에 바로 쌓여서 지저분해진다는 문제가 있었다).
ipcMain.handle('caelus:send-command', async (event, text, mode, projectName) => {
  // 렌더러가 isBusy로 "한 번에 하나만" 보내도록 막고 있지만, 방어적으로
  // 메인 프로세스 쪽에서도 재진입을 막는다 — 안 막으면 두 번째 호출이
  // activeChild/activeTaskId를 덮어써서 취소 버튼이 엉뚱한 프로세스를
  // 가리키게 되고, 두 요청의 store 기록이 서로 뒤섞일 수 있다.
  if (activeChild) {
    throw new Error('이미 처리 중인 요청이 있습니다. 완료된 뒤 다시 시도해주세요.');
  }

  const targetProject = projectName || DEFAULT_PROJECT_NAME;
  // create/rename-project처럼 여기서도 같은 안전성 검사를 거친다 — 지금은
  // 렌더러가 항상 검증된 프로젝트 이름만 넘기지만(그 외 값이 들어올 통로가
  // 없지만), 메인 프로세스 스스로도 이 경계를 지켜야 방어 종심이 된다.
  const cwd = targetProject === DEFAULT_PROJECT_NAME
    ? path.join(PROJECTS_DIR, DEFAULT_PROJECT_NAME)
    : safeProjectPath(targetProject);
  if (!cwd) {
    throw new Error('잘못된 프로젝트입니다.');
  }
  if (!fs.existsSync(cwd)) {
    fs.mkdirSync(cwd, { recursive: true });
  }

  // §I — code 모드로 파일을 고치기 시작하기 직전에 지금 상태를 스냅샷
  // 커밋해둔다(최선 노력 — 실패해도 요청 자체는 계속 진행). chat 모드는
  // 파일을 안 건드리므로 스냅샷이 필요 없다.
  if (mode === 'code') {
    await snapshotProjectBeforeCodeMode(cwd);
  }

  // 이 프로젝트에 이미 이어지고 있는 대화 스레드가 있으면 그걸 --resume,
  // 없으면 새로 만든 uuid를 --session-id로 시작한다.
  const existingThread = store.getActiveThread(targetProject);
  const isNewThread = !existingThread;
  const threadId = existingThread || crypto.randomUUID();

  const task = store.createTask(text, mode, { project: targetProject, claudeSessionId: threadId });
  activeTaskId = task.task_id;
  send(event, 'caelus:status', { state: 'listening', taskId: task.task_id });

  const attempt = (sessionId, resume) =>
    claude.send({
      prompt: text,
      mode,
      cwd,
      sessionId,
      resume,
      model: store.getModel() || undefined, // §L — null이면 undefined로 넘겨 CLI 기본값 사용
      onChunk: (chunk) => {
        send(event, 'caelus:stream', { taskId: task.task_id, chunk });
      },
      onSpawn: (child) => {
        activeChild = child;
      },
    });

  try {
    let finalThreadId = threadId;
    let responseText;
    try {
      responseText = await attempt(threadId, !isNewThread);
    } catch (err) {
      // 기존 스레드를 이어가려던 시도가 "--resume 이 그 스레드를 못 찾음"
      // 종류의 실패면, 새 스레드로 한 번만 폴백 재시도한다. 그 외 실패(인증,
      // 네트워크, 취소 등)는 그대로 위로 전파한다(조용히 삼키지 않음).
      if (!isNewThread && isResumeFailure(err)) {
        finalThreadId = crypto.randomUUID();
        responseText = await attempt(finalThreadId, false);
        store.updateTaskThread(task.task_id, finalThreadId);
      } else {
        throw err;
      }
    }

    store.appendLog(task.task_id, responseText);
    store.updateTaskStatus(task.task_id, 'done');
    store.setActiveThread(targetProject, finalThreadId);
    send(event, 'caelus:status', { state: 'response', taskId: task.task_id });
    notifyIfAway('CAELUS 응답 도착', task.title);

    return { taskId: task.task_id, text: responseText };
  } catch (err) {
    if (err.cancelled) {
      // 취소 — claudeBridge.js가 그때까지 쌓인 stdout을 err.partialText로
      // 실어 보낸다. "[오류]"가 아니라 "[중단됨]"으로 저장해 실제 응답
      // 내용을 보존한다(§M "일시정지" 기능의 전제 — 저장하고 중단).
      // ⚠️ ipcMain.handle에서 던진 Error는 렌더러로 건너갈 때 message
      // 문자열만 남고 커스텀 속성(cancelled/partialText)이 사라지므로,
      // 여기서는 throw하지 않고 정상 반환값에 담아 보낸다.
      const partial = err.partialText || '';
      store.updateTaskStatus(task.task_id, 'cancelled');
      store.appendLog(task.task_id, `[중단됨] ${partial}`);
      send(event, 'caelus:status', { state: 'cancelled', taskId: task.task_id });
      return { taskId: task.task_id, cancelled: true, text: partial };
    }
    store.updateTaskStatus(task.task_id, 'error');
    store.appendLog(task.task_id, `[오류] ${err.message}`);
    send(event, 'caelus:status', { state: 'error', taskId: task.task_id, message: err.message });
    notifyIfAway('CAELUS 오류', task.title);
    throw err;
  } finally {
    activeChild = null;
    activeTaskId = null;
  }
});
