const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("botgo", Object.freeze({
  startWebAuthorization: () => invoke("auth:start-web-authorization"),
  cancelWebAuthorization: () => invoke("auth:cancel-web-authorization"),
  account: () => invoke("account:get"),
  history: () => invoke("history:get"),
  chooseProject: () => invoke("project:choose"),
  rememberProject: (projectPath) => invoke("project:remember", projectPath),
  createThread: (projectPath) => invoke("thread:create", projectPath),
  selectThread: (threadId) => invoke("thread:select", threadId),
  prepare: (confirmConfigReplace) => invoke("runtime:prepare", { confirmConfigReplace: Boolean(confirmConfigReplace) }),
  openTerminal: (context) => invoke("runtime:open-terminal", context),
  startTask: (task) => invoke("task:start", task),
  stopTask: () => invoke("task:stop"),
  restoreConfiguration: () => invoke("runtime:restore-config"),
  revokeDevice: () => invoke("account:revoke-device"),
  openAccountPage: () => invoke("account:open-page"),
  onTaskEvent: (listener) => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on("task:event", handler);
    return () => ipcRenderer.removeListener("task:event", handler);
  },
  onAuthorizationEvent: (listener) => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on("authorization:event", handler);
    return () => ipcRenderer.removeListener("authorization:event", handler);
  }
}));
