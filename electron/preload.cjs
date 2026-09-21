const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('coastlineDesktop', {
  getFullscreen: () => ipcRenderer.invoke('coastline:fullscreen-get'),
  toggleFullscreen: () => ipcRenderer.invoke('coastline:fullscreen-toggle'),
  onFullscreenChange: callback => {
    ipcRenderer.on('coastline:fullscreen-changed', (_event, active) => callback(active));
  },
  onEscape: callback => {
    ipcRenderer.on('coastline:escape', () => callback());
  },
  getUpdate: () => ipcRenderer.invoke('coastline:update-get'),
  onUpdate: callback => {
    ipcRenderer.on('coastline:update-available', (_event, update) => callback(update));
  },
});
