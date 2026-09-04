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
  openUsagePage: () => ipcRenderer.invoke('caelus:open-usage-page'),

  listProjects: () => ipcRenderer.invoke('caelus:list-projects'),
  createProject: (name) => ipcRenderer.invoke('caelus:create-project', name),
  renameProject: (oldName, newName) => ipcRenderer.invoke('caelus:rename-project', oldName, newName),
  deleteProject: (name) => ipcRenderer.invoke('caelus:delete-project', name),

  getPersona: (project) => ipcRenderer.invoke('caelus:get-persona', project),
  setPersona: (project, text) => ipcRenderer.invoke('caelus:set-persona', project, text),

  listWorkspaceFiles: (project, relPath) => ipcRenderer.invoke('caelus:list-workspace-files', project, relPath),
  readWorkspaceFile: (project, relPath) => ipcRenderer.invoke('caelus:read-workspace-file', project, relPath),

  listPresets: () => ipcRenderer.invoke('caelus:list-presets'),
  addPreset: (label, text) => ipcRenderer.invoke('caelus:add-preset', label, text),
  updatePreset: (id, fields) => ipcRenderer.invoke('caelus:update-preset', id, fields),
  deletePreset: (id) => ipcRenderer.invoke('caelus:delete-preset', id),

  getThreadInfo: (project) => ipcRenderer.invoke('caelus:get-thread-info', project),
  startNewThread: (project) => ipcRenderer.invoke('caelus:new-thread', project),
  resumeThread: (project, threadId) => ipcRenderer.invoke('caelus:resume-thread', project, threadId),
  renameTask: (taskId, newTitle) => ipcRenderer.invoke('caelus:rename-task', taskId, newTitle),

  copyText: (text) => ipcRenderer.invoke('caelus:copy-text', text),
  exportConversation: (content, suggestedName) =>
    ipcRenderer.invoke('caelus:export-conversation', { content, suggestedName }),
  checkUpdate: () => ipcRenderer.invoke('caelus:check-update'),
  quitApp: () => ipcRenderer.invoke('caelus:quit-app'),

  onStatus: (callback) => {
    ipcRenderer.on('caelus:status', (_event, payload) => callback(payload));
  },
  onStream: (callback) => {
    ipcRenderer.on('caelus:stream', (_event, payload) => callback(payload));
  },
});
