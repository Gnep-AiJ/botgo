const { contextBridge, ipcRenderer } = require("electron");

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld("botgo", Object.freeze({
  startWebAuthorization: () => invoke("auth:start-web-authorization"),
  cancelWebAuthorization: () => invoke("auth:cancel-web-authorization"),
  account: () => invoke("account:get"),
  models: () => invoke('models:get'),
  history: () => invoke("history:get"),
  chooseProject: () => invoke("project:choose"),
  rememberProject: (projectPath) => invoke("project:remember", projectPath),
  createThread: (projectPath) => invoke("thread:create", projectPath),
  selectThread: (threadId) => invoke("thread:select", threadId),
  renameThread: (id, title) => invoke('thread:rename', { id, title }),
  deleteThread: (id) => invoke('thread:delete', id),
  removeProject: (projectPath) => invoke('project:remove', projectPath),
  prepare: (confirmConfigReplace) => invoke("runtime:prepare", { confirmConfigReplace: Boolean(confirmConfigReplace) }),
  openTerminal: (context) => invoke("runtime:open-terminal", context),
  onTerminalEvent: (listener) => {
    const handler = (_event, value) => listener(value);
    ipcRenderer.on('terminal:event', handler);
    return () => ipcRenderer.removeListener('terminal:event', handler);
  },
  extensions: () => invoke('extensions:list'),
  saveMcp: spec => invoke('mcp:save', spec),
  toggleMcp: (name, enabled) => invoke('mcp:toggle', { name, enabled }),
  reconnectMcp: () => invoke('mcp:reconnect'),
  loginMcp: name => invoke('mcp:login', name),
  cancelMcpLogin: () => invoke('mcp:cancel-login'),
  importConfiguration: () => invoke('configuration:import'),
  readSkill: id => invoke('skills:read', id),
  toggleSkill: (id, enabled) => invoke('skills:toggle', { id, enabled }),
  installSkill: () => invoke('skills:install'),
  readPlugin: id => invoke('plugins:read', id),
  addPluginMarketplace: () => invoke('plugins:add-marketplace'),
  installPlugin: id => invoke('plugins:install', id),
  togglePlugin: (id, enabled) => invoke('plugins:toggle', { id, enabled }),
  forkThread: id => invoke('thread:fork', id),
  archiveThread: (id, archived) => invoke('thread:archive', { id, archived }),
  chooseAttachments: () => invoke('attachments:choose'),
  steerTask: (threadId, text) => invoke('task:steer', { threadId, text }),
  startTask: (task) => invoke("task:start", task),
  stopTask: () => invoke("task:stop"),
  openRequestUrl: (threadId, requestId) => invoke('task:open-request-url', { threadId, requestId }),
  respondToRequest: (response) => invoke('task:respond', response),
  historyPage: (threadId, before) => invoke('history:page', { threadId, before }),
  checkUpdate: () => invoke('update:check'),
  installUpdate: () => invoke('update:install'),
  onUpdate: listener => { const handler = (_event, value) => listener(value); ipcRenderer.on('update:event', handler); return () => ipcRenderer.removeListener('update:event', handler); },
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
