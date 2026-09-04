const { app, BrowserWindow, ipcMain, clipboard, dialog, shell } = require('electron');
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
ipcMain.handle('caelus:create-project', (event, name) => {
  const trimmed = String(name || '').trim();
  const check = validateProjectName(trimmed);
  if (!check.ok) return { created: false, reason: check.reason };

  try {
    fs.mkdirSync(check.target, { recursive: true });
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
    throw err;
  } finally {
    activeChild = null;
    activeTaskId = null;
  }
});
