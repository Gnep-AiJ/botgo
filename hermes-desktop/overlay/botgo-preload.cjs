const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('botgo', {
  state: force => ipcRenderer.invoke('botgo:state', force === true),
  login: () => ipcRenderer.invoke('botgo:login'),
  logout: () => ipcRenderer.invoke('botgo:logout'),
  account: () => ipcRenderer.invoke('botgo:account'),
  open: target => ipcRenderer.invoke('botgo:open', target),
  weixinState: () => ipcRenderer.invoke('botgo:weixin:state'),
  weixinStart: () => ipcRenderer.invoke('botgo:weixin:start'),
  weixinCancel: () => ipcRenderer.invoke('botgo:weixin:cancel'),
  weixinDisconnect: () => ipcRenderer.invoke('botgo:weixin:disconnect'),
  qqState: () => ipcRenderer.invoke('botgo:qq:state'),
  qqStart: () => ipcRenderer.invoke('botgo:qq:start'),
  qqCancel: () => ipcRenderer.invoke('botgo:qq:cancel'),
  qqDisconnect: () => ipcRenderer.invoke('botgo:qq:disconnect'),
  checkUpdates: () => ipcRenderer.invoke('botgo:updates:check'),
  installUpdate: () => ipcRenderer.invoke('botgo:updates:install'),
  onChanged: listener => { const receive = (_event, value) => listener(value); ipcRenderer.on('botgo:changed', receive); return () => ipcRenderer.removeListener('botgo:changed', receive); },
});
