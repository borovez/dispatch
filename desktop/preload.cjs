// The lock screen's only bridge to the app: ask the main process to unlock (Touch ID / password)
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('dispatchLock', { unlock: () => ipcRenderer.invoke('dispatch:unlock') })
