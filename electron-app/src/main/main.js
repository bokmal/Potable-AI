const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { ClaudeBridge } = require('./claudeBridge');
const { Store } = require('./store');

let mainWindow;
const claude = new ClaudeBridge();
const store = new Store();

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
