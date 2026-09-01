const { contextBridge, ipcRenderer } = require('electron');

// 렌더러(UI)에는 필요한 채널만 좁혀서 노출한다 (contextIsolation 유지, nodeIntegration 없음).
contextBridge.exposeInMainWorld('caelus', {
  sendCommand: (text, mode, projectName) =>
    ipcRenderer.invoke('caelus:send-command', text, mode, projectName),
  cancelCommand: (taskId) => ipcRenderer.invoke('caelus:cancel-command', taskId),

  getHistory: () => ipcRenderer.invoke('caelus:get-history'),
  getTask: (taskId) => ipcRenderer.invoke('caelus:get-task', taskId),
  deleteTask: (taskId) => ipcRenderer.invoke('caelus:delete-task', taskId),
  clearHistory: () => ipcRenderer.invoke('caelus:clear-history'),
  getUsage: () => ipcRenderer.invoke('caelus:get-usage'),

  listProjects: () => ipcRenderer.invoke('caelus:list-projects'),
  copyText: (text) => ipcRenderer.invoke('caelus:copy-text', text),
  exportConversation: (content, suggestedName) =>
    ipcRenderer.invoke('caelus:export-conversation', { content, suggestedName }),
  checkUpdate: () => ipcRenderer.invoke('caelus:check-update'),

  onStatus: (callback) => {
    ipcRenderer.on('caelus:status', (_event, payload) => callback(payload));
  },
  onStream: (callback) => {
    ipcRenderer.on('caelus:stream', (_event, payload) => callback(payload));
  },
});
