const { contextBridge, ipcRenderer } = require('electron');

// 렌더러(UI)에는 필요한 채널만 좁혀서 노출한다 (contextIsolation 유지, nodeIntegration 없음).
contextBridge.exposeInMainWorld('caelus', {
  sendCommand: (text, mode) => ipcRenderer.invoke('caelus:send-command', text, mode),
  getHistory: () => ipcRenderer.invoke('caelus:get-history'),
  onStatus: (callback) => {
    ipcRenderer.on('caelus:status', (_event, payload) => callback(payload));
  },
  onStream: (callback) => {
    ipcRenderer.on('caelus:stream', (_event, payload) => callback(payload));
  },
});
