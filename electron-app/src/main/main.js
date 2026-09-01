const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
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

let mainWindow;
const claude = new ClaudeBridge();
const store = new Store();

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

// --- IPC: 명령 전송 → Claude Code CLI 호출 ---
// UI 상태 전이: listening(입력 처리 중) → response(완료) / error(오류)
ipcMain.handle('caelus:send-command', async (event, text) => {
  const task = store.createTask(text);
  send(event, 'caelus:status', { state: 'listening', taskId: task.task_id });

  try {
    const responseText = await claude.send(text, (chunk) => {
      send(event, 'caelus:stream', { taskId: task.task_id, chunk });
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
  }
});
