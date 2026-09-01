const { app, BrowserWindow, ipcMain, clipboard, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { ClaudeBridge } = require('./claudeBridge');
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

let mainWindow;
const claude = new ClaudeBridge();
const store = new Store();

// 현재 진행 중인 요청 하나만 추적한다(동시에 여러 요청은 아직 지원하지
// 않음 — UI도 입력창을 잠가 한 번에 하나씩만 보내도록 되어 있다).
let activeChild = null;
let activeTaskId = null;

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
ipcMain.handle('caelus:list-projects', () => {
  try {
    if (!fs.existsSync(PROJECTS_DIR)) return [];
    return fs
      .readdirSync(PROJECTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b, 'ko'));
  } catch (err) {
    console.error(`[CAELUS] projects 목록 조회 실패: ${err.message}`);
    return [];
  }
});

// --- IPC: projects\ 아래에 새 폴더 만들기 ---
ipcMain.handle('caelus:create-project', (event, name) => {
  const trimmed = String(name || '').trim();
  if (!trimmed) {
    return { created: false, reason: '이름을 입력해주세요.' };
  }
  // 경로 구분자나 ".."이 들어오면 projects\ 바깥에 폴더를 만들 수 있게 되므로
  // 막는다. Windows에서 파일/폴더 이름에 못 쓰는 문자도 같이 걸러낸다.
  if (/[\\/:*?"<>|]/.test(trimmed) || trimmed === '.' || trimmed === '..') {
    return { created: false, reason: '폴더 이름에 \\ / : * ? " < > | 는 쓸 수 없습니다.' };
  }

  const target = path.join(PROJECTS_DIR, trimmed);
  // 위 필터를 통과하더라도 이중으로 확인한다 — 결과 경로가 반드시
  // PROJECTS_DIR 바로 아래여야 한다.
  if (path.dirname(target) !== PROJECTS_DIR) {
    return { created: false, reason: '잘못된 이름입니다.' };
  }
  if (fs.existsSync(target)) {
    return { created: false, reason: '이미 있는 폴더입니다.' };
  }

  try {
    fs.mkdirSync(target, { recursive: true });
    return { created: true, name: trimmed };
  } catch (err) {
    return { created: false, reason: err.message };
  }
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
    activeChild.kill();
    return true;
  }
  return false;
});

// --- IPC: 명령 전송 → Claude Code CLI 호출 ---
// UI 상태 전이: listening(입력 처리 중) → response(완료) / error(오류)
// mode: 'chat'(기본, 대화체) | 'code'(CLI 기본 동작 — 신중한 코딩 에이전트)
// projectName: projects\<projectName> 을 작업 디렉터리로 사용(선택, 안 고르면
// projects\ 자체를 씀 — electron-app\ 폴더가 기본값이 되는 걸 방지)
ipcMain.handle('caelus:send-command', async (event, text, mode, projectName) => {
  const task = store.createTask(text, mode);
  activeTaskId = task.task_id;
  send(event, 'caelus:status', { state: 'listening', taskId: task.task_id });

  // 프로젝트를 안 골라도 최소한 projects\ 폴더를 작업 디렉터리로 쓴다.
  // (undefined로 두면 Electron 프로세스 자신의 cwd, 즉 electron-app\ 폴더가
  // 기본값이 돼서 코딩 모드 결과물이 앱 소스 코드 폴더에 섞여 들어가는
  // 문제가 있었다 — projects\ 자체는 이미 있는 폴더이므로 안전한 기본값이다.)
  const cwd = projectName ? path.join(PROJECTS_DIR, projectName) : PROJECTS_DIR;

  try {
    const responseText = await claude.send({
      prompt: text,
      mode,
      cwd,
      onChunk: (chunk) => {
        send(event, 'caelus:stream', { taskId: task.task_id, chunk });
      },
      onSpawn: (child) => {
        activeChild = child;
      },
    });

    store.appendLog(task.task_id, responseText);
    store.updateTaskStatus(task.task_id, 'done');
    send(event, 'caelus:status', { state: 'response', taskId: task.task_id });

    return { taskId: task.task_id, text: responseText };
  } catch (err) {
    store.updateTaskStatus(task.task_id, 'error');
    store.appendLog(task.task_id, `[오류] ${err.message}`);
    send(event, 'caelus:status', { state: 'error', taskId: task.task_id, message: err.message });
    throw err;
  } finally {
    activeChild = null;
    activeTaskId = null;
  }
});
