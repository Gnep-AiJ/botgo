const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { spawn, execFile } = require("node:child_process");

// Chromium starts its GPU process before runtime command-line changes are applied on
// affected Windows hosts. Relaunch once with the switches already on process.argv;
// the renderer sandbox remains enabled in the child process.
const gpuFallbackArgs = ["--disable-gpu", "--disable-gpu-compositing"];
if (process.platform === "win32" && !process.argv.includes("--disable-gpu")) {
  const relaunch = spawn(process.execPath, [...gpuFallbackArgs, ...process.argv.slice(1)], {
    detached: true,
    stdio: "ignore"
  });
  relaunch.unref();
  app.exit(0);
}
const { promisify } = require("node:util");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { createCredentialStore } = require("./lib/credential-store.cjs");
const { createLocalStateStore } = require("./lib/local-state.cjs");
const { createUpdater } = require('./lib/updater.cjs');
const { restoreOriginalConfig } = require("./lib/codex-config.cjs");
const { callbackResultFor, createWebAuthorizationProof } = require("./lib/web-auth.cjs");

const execFileAsync = promisify(execFile);
const { agentRoot, nativeCommand, openNativeTerminal, createAppServerRunner, writeCodexConfig } = require("./lib/agent-runtime.cjs");
function buildTimeApiOrigin() {
  try { return require("./runtime-config.cjs").apiOrigin || ""; } catch { return ""; }
}
const pagesOrigin = (process.env.BOTGO_API_ORIGIN || buildTimeApiOrigin() || "").replace(/\/$/, "");
let mainWindow;
let activeTask;
let runtimeService, runtimeConnecting, runtimeModel, runtimeEpoch = 0;
let activeThreadId;
let taskStarting = false;
let cancelTaskStart = false;
let terminalStarting = false, terminalRunning = false;
let activeAuthorization;
let updater, nativePanel;
let updateInstalling = false;
function updaterInstance() {
  if (!updater) updater = createUpdater({
    directory: path.join(app.getPath('userData'), 'updates'), version: app.getVersion(), origin: requireApiOrigin(),
    currentRelease: async () => (await apiRequest('/desktop/releases/current', { deviceToken: (await credential()).deviceToken })).release,
    verifySignature: async file => {
      // Path is generated locally from the SHA-256, never supplied by the renderer.
      const verifier = path.join(app.getPath('userData'), 'updates', 'verify-signature.ps1');
      fs.mkdirSync(path.dirname(verifier), { recursive: true });
      fs.writeFileSync(verifier, fs.readFileSync(path.join(__dirname, 'lib', 'verify-signature.ps1')));
      try { await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', verifier, '-FilePath', file], { windowsHide: true, timeout: 30000 }); }
      catch { throw Error('安装包签名不匹配，更新已拒绝。'); }
    },
    onState: status => { if (!mainWindow?.isDestroyed()) mainWindow?.webContents.send('update:event', status); }
  });
  return updater;
}
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.on('second-instance', () => {
  if (mainWindow?.isMinimized()) mainWindow.restore();
  mainWindow?.show(); mainWindow?.focus();
});

function requireApiOrigin() {
  if (!/^https:\/\//.test(pagesOrigin)) throw new Error("Desktop release is missing its BotGo service address. Contact BotGo support.");
  return pagesOrigin;
}

function appPaths() {
  const data = app.getPath("userData");
  return {
    credentials: path.join(data, "credentials.bin"),
    history: path.join(data, "state.json"),
    backups: path.join(data, "backups"),
    metadata: path.join(data, "runtime.json"),
    codexConfig: path.join(app.getPath("home"), ".codex", "config.toml"),
    codexHome: path.join(data, "codex")
  };
}

function credentials() { return createCredentialStore({ filePath: appPaths().credentials, safeStorage }); }
function state() { return createLocalStateStore({ filePath: appPaths().history }); }
function publicHistory(history) {
  return { ...history, threads: history.threads.map(thread => ({ ...thread, messageCount: thread.messages.length, before: Math.max(0, thread.messages.length - 100), messages: thread.messages.slice(-100) })) };
}
function validProject(projectPath) {
  try {
    if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) throw Error();
    const resolved = fs.realpathSync(projectPath);
    if (!fs.statSync(resolved).isDirectory()) throw Error();
    return resolved;
  } catch { throw Error('工作文件夹已移动或无法访问，请重新选择。'); }
}
function sendTaskEvent(event) { mainWindow?.webContents.send("task:event", event); }
function sendAuthorizationEvent(event) { mainWindow?.webContents.send("authorization:event", event); }

function closeActiveAuthorization() {
  if (!activeAuthorization) return;
  clearTimeout(activeAuthorization.timeout);
  activeAuthorization.server.close();
  activeAuthorization = null;
}

function callbackPage(status, message) {
  const safeMessage = String(message).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BotGo Desktop</title><body style="margin:0;display:grid;min-height:100vh;place-items:center;background:#07182d;color:#f3f9ff;font:16px system-ui"><main style="max-width:460px;padding:32px;text-align:center"><h1>${status}</h1><p style="color:#9bc0d9;line-height:1.6">${safeMessage}</p></main></body></html>`;
}

function createCallbackServer(proof) {
  let resolvePort;
  let rejectPort;
  const port = new Promise((resolve, reject) => { resolvePort = resolve; rejectPort = reject; });
  const server = http.createServer(async (request, response) => {
    if (request.method !== "GET") {
      response.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      response.end("Method not allowed");
      return;
    }
    let result;
    try {
      result = callbackResultFor(request.url || "/", proof.state);
    } catch {
      response.writeHead(400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(callbackPage("授权未完成", "返回请求无效。请回到 BotGo Desktop 后重试。"));
      return;
    }
    const outcome = await finishBrowserAuthorization(result.code);
    response.writeHead(outcome.ok ? 200 : 500, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(outcome.ok
      ? callbackPage("授权完成", "可以关闭此浏览器页面并返回 BotGo Desktop。")
      : callbackPage("授权未完成", "桌面应用未能保存设备凭据。请回到 BotGo Desktop 后重试。"));
  });
  server.once("error", rejectPort);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return rejectPort(new Error("Unable to reserve the local authorization callback"));
    resolvePort(address.port);
  });
  return { server, port };
}

async function finishBrowserAuthorization(authorizationCode) {
  const pending = activeAuthorization;
  if (!pending || pending.finishing) return;
  pending.finishing = true;
  try {
    const result = await apiRequest("/desktop/authorize/exchange", {
      method: "POST",
      body: { authorizationId: pending.authorizationId, authorizationCode, verifier: pending.proof.verifier }
    });
    credentials().save({ deviceToken: result.deviceToken });
    closeActiveAuthorization();
    defaultWorkspace();
    sendAuthorizationEvent({ type: "completed", account: result.account });
    return { ok: true };
  } catch (error) {
    closeActiveAuthorization();
    sendAuthorizationEvent({ type: "error", message: error.message || "浏览器授权未能完成。" });
    return { ok: false };
  }
}

async function startBrowserAuthorization() {
  if (activeAuthorization) return { pending: true };
  const proof = createWebAuthorizationProof();
  const { server, port } = createCallbackServer(proof);
  try {
    const started = await apiRequest("/desktop/authorize/start", {
      method: "POST",
      body: { deviceLabel: `BotGo Desktop (${process.platform})`, verifier: proof.verifier }
    });
    const callback = `http://127.0.0.1:${await port}/callback`;
    activeAuthorization = {
      authorizationId: started.authorizationId,
      proof,
      server,
      finishing: false,
      timeout: setTimeout(async () => {
        const pending = activeAuthorization;
        if (!pending) return;
        try {
          await apiRequest("/desktop/authorize/cancel", { method: "POST", body: { authorizationId: pending.authorizationId, verifier: pending.proof.verifier } });
        } catch {}
        closeActiveAuthorization();
        sendAuthorizationEvent({ type: "expired", message: "网页授权已超时，请重新开始。" });
      }, 1000 * 60 * 5)
    };
    const page = new URL("/desktop-authorize.html", requireApiOrigin());
    page.searchParams.set("request", started.authorizationId);
    page.searchParams.set("state", proof.state);
    page.searchParams.set("callback", callback);
    await shell.openExternal(page.toString());
    sendAuthorizationEvent({ type: "waiting" });
    return { pending: true };
  } catch (error) {
    if (activeAuthorization?.server === server) closeActiveAuthorization();
    else server.close();
    throw error;
  }
}

async function cancelBrowserAuthorization() {
  const pending = activeAuthorization;
  if (!pending) return { ok: true };
  try {
    await apiRequest("/desktop/authorize/cancel", { method: "POST", body: { authorizationId: pending.authorizationId, verifier: pending.proof.verifier } });
  } finally {
    closeActiveAuthorization();
  }
  sendAuthorizationEvent({ type: "cancelled" });
  return { ok: true };
}

function rememberProject(projectPath) {
  if (typeof projectPath !== "string" || !projectPath.trim()) throw new Error("请选择本地文件夹。");
  const history = state().load();
  const selectedProject = validProject(projectPath);
  const next = {
    ...history,
    selectedProject,
    recentProjects: [selectedProject, ...history.recentProjects.filter((item) => item !== selectedProject)]
  };
  state().save(next);
  return state().load();
}

function createThread(projectPath) {
  const history = rememberProject(projectPath);
  const thread = { id: crypto.randomUUID(), projectPath, title: "新对话", sessionId: "", status: "idle", messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  state().save({ ...history, selectedProject: projectPath, selectedThreadId: thread.id, threads: [thread, ...history.threads] });
  return state().load();
}

function selectThread(threadId) {
  const history = state().load(); const thread = history.threads.find((item) => item.id === threadId);
  if (!thread) throw new Error("对话不存在。");
  state().save({ ...history, selectedProject: thread.projectPath, selectedThreadId: thread.id });
  return state().load();
}

async function apiRequest(endpoint, { method = "GET", body, deviceToken } = {}) {
  const response = await fetch(`${requireApiOrigin()}/api${endpoint}`, {
    method,
    signal: AbortSignal.timeout(20000),
    headers: {
      "content-type": "application/json",
      ...(deviceToken ? { authorization: `Bearer ${deviceToken}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) closeRuntime();
    throw new Error(payload.error || "BotGo service is unavailable.");
  }
  return payload;
}

async function credential() {
  const value = credentials().load();
  if (!value?.deviceToken) throw new Error("请先登录。");
  return value;
}

function closeRuntime() {
  runtimeEpoch++; runtimeService?.close(); runtimeService = null; runtimeModel = null;
}
function defaultWorkspace() {
  const history = state().load();
  if (history.selectedProject) return history;
  const projectPath = path.join(app.getPath('home'), 'BotGo', 'Workspace');
  fs.mkdirSync(projectPath, { recursive: true });
  return rememberProject(projectPath);
}
async function ensureRuntime(model) {
  if (runtimeConnecting) return runtimeConnecting;
  if (runtimeService?.connected && runtimeModel === model) return runtimeService;
  if (runtimeService) closeRuntime();
  const epoch = runtimeEpoch;
  runtimeConnecting = (async () => {
    const current = await credential();
    await prepareRuntime();
    const history = defaultWorkspace();
    const issued = await apiRequest('/desktop/key', { method: 'POST', deviceToken: current.deviceToken, body: { model } });
    if (epoch !== runtimeEpoch) throw Error('连接或授权请求已取消。');
    const runner = createAppServerRunner({ command: nativeCommand(agentRoot), onEvent: sendTaskEvent });
    runtimeService = runner;
    try {
      await runner.connect({ projectPath: validProject(history.selectedProject), codexHome: appPaths().codexHome,
        relayKey: issued.key, relayOrigin: requireApiOrigin(), model });
      if (epoch !== runtimeEpoch) { runner.close(); throw Error('连接或授权请求已取消。'); }
      runtimeModel = model;
      return runner;
    } finally { issued.key = undefined; }
  })();
  try { return await runtimeConnecting; } finally { runtimeConnecting = null; }
}

async function prepareRuntime() {
  const paths = appPaths();
  const command = nativeCommand(agentRoot);
  await execFileAsync(command, ["--version"], { windowsHide: true });
  // Preserve resumable sessions belonging to BotGo's known local threads only.
  const oldSessions = path.join(app.getPath("home"), ".codex", "sessions");
  const ids = new Set(state().load().threads.map(t => t.sessionId).filter(Boolean));
  const copySessions = directory => {
    if (!fs.existsSync(directory)) return;
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      const source = path.join(directory, item.name);
      if (item.isDirectory()) copySessions(source);
      else if (item.name.endsWith(".jsonl") && [...ids].some(id => item.name.includes(id))) {
        const target = path.join(paths.codexHome, "sessions", path.relative(oldSessions, source));
        if (!fs.existsSync(target)) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); }
      }
    }
  };
  if (ids.size) copySessions(oldSessions);
  writeCodexConfig({ codexHome: paths.codexHome, relayOrigin: requireApiOrigin() });
  return { ready: true };
}

const attachmentHandles = new Map();
function resolveAttachments(ids = []) {
  if (!Array.isArray(ids) || ids.length > 16) throw Error('最多添加 16 个附件。');
  return ids.map(id => {
    const file = attachmentHandles.get(id);
    if (!file || !fs.statSync(file.path).isFile()) throw Error('附件已失效，请重新选择。');
    return /\.(png|jpe?g|webp|gif)$/i.test(file.path)
      ? { type: 'localImage', path: file.path }
      : { type: 'mention', name: path.basename(file.path), path: file.path };
  });
}

function createWindow() {
  app.setAppUserModelId("com.botgo.desktop");
  mainWindow = new BrowserWindow({
    show: false,
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 650,
    backgroundColor: "#1b1c1f",
    icon: path.join(__dirname, "assets", "botgo-desktop.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.once('ready-to-show', () => {
    mainWindow.center();
    mainWindow.show();
    mainWindow.focus();
  });
  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  try { state().recoverInterruptedThreads(); }
  catch (error) { dialog.showErrorBox('无法读取本地记录', error.message); }
  nativePanel = require('./lib/native-panel.cjs').registerNativePanel({ ipcMain, dialog, shell, window: () => mainWindow, ensureRuntime, closeRuntime, state, paths: appPaths, busy: () => activeTask || taskStarting || terminalStarting || terminalRunning, publicHistory });
  ipcMain.handle("auth:start-web-authorization", async () => startBrowserAuthorization());
  ipcMain.handle("auth:cancel-web-authorization", async () => cancelBrowserAuthorization());
  ipcMain.handle("account:get", async () => {
    const current = await credential();
    return apiRequest("/desktop/account", { deviceToken: current.deviceToken });
  });
  ipcMain.handle("history:get", async () => publicHistory(state().load()));
  ipcMain.handle('history:page', (_event, { threadId, before }) => {
    const thread = state().load().threads.find(t => t.id === threadId);
    if (!thread || !Number.isSafeInteger(before) || before < 0) throw Error('Invalid history page');
    const end = Math.min(before, thread.messages.length), start = Math.max(0, end - 100);
    return { messages: thread.messages.slice(start, end), before: start };
  });
  ipcMain.handle('models:get', async () => apiRequest('/models', { deviceToken: credentials().load()?.deviceToken }));
  ipcMain.handle("project:choose", async () => {
    const selected = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return selected.filePaths[0];
  });
  ipcMain.handle("project:remember", async (_event, projectPath) => publicHistory(rememberProject(projectPath)));
  ipcMain.handle("thread:create", async (_event, projectPath) => publicHistory(createThread(projectPath)));
  ipcMain.handle("thread:select", async (_event, threadId) => publicHistory(selectThread(threadId)));
  for (const [channel, operation] of [
    ['thread:rename', async ({ id, title }) => {
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 64) throw Error('请输入 1–64 字的对话名称。');
      const thread = state().load().threads.find(t => t.id === id);
      if (thread?.sessionId) await (await ensureRuntime()).request('thread/name/set', { threadId: thread.sessionId, name: title.trim() });
      return state().renameThread(id, title);
    }],
    ['thread:delete', id => state().deleteThread(id)],
    ['project:remove', projectPath => state().removeProject(projectPath)]
  ]) ipcMain.handle(channel, async (_event, payload) => {
    if (activeTask || taskStarting) throw new Error('请先停止当前任务。');
    return publicHistory(await operation(payload));
  });
  ipcMain.handle("runtime:prepare", async () => {
    await credential(); defaultWorkspace(); await ensureRuntime(); return { ready: true };
  });
  ipcMain.handle("runtime:restore-config", async () => {
    const metadata = JSON.parse(fs.readFileSync(appPaths().metadata, "utf8"));
    restoreOriginalConfig({ configPath: appPaths().codexConfig, backupPath: metadata.backupPath });
    return { ok: true };
  });
  ipcMain.handle('update:check', () => updaterInstance().check());
  ipcMain.handle('update:install', async () => {
    if (activeTask || taskStarting || terminalStarting || terminalRunning || updateInstalling) throw Error('Finish or stop the current task before updating.');
    updateInstalling = true;
    try {
      const file = await updaterInstance().installer();
      const installer = spawn(file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore', windowsHide: true });
      await new Promise((resolve, reject) => { installer.once('spawn', resolve); installer.once('error', reject); });
      installer.unref(); app.quit(); return { ok: true };
    } catch (error) { updateInstalling = false; throw error; }
  });
  ipcMain.handle("task:start", async (_event, task) => {
    if (activeTask || taskStarting || terminalStarting || terminalRunning || updateInstalling || nativePanel?.busy) throw new Error("已有任务或扩展操作正在运行。");
    if (!task || typeof task.prompt !== "string" || !task.prompt.trim() || typeof task.projectPath !== "string" || !validProject(task.projectPath)) throw new Error("请选择项目并输入任务。");
    if (!["read-only", "workspace-write", "full-access"].includes(task.mode)) throw new Error("权限模式无效。");
    if (task.mode === "full-access" && !task.confirmedFullAccess) throw new Error("完全访问需要确认。");
    if (!['auto_review', 'user'].includes(task.reviewer)) throw Error('审批方式无效。');
    const nativeInput = [...resolveAttachments(task.attachments), ...nativePanel.skillInput(task.skills)];
    taskStarting = true;
    cancelTaskStart = false;
    try {
    const current = await credential();
    const account = await apiRequest("/desktop/account", { deviceToken: current.deviceToken });
    if (!Number.isFinite(account.account?.credits) || account.account.credits <= 0) throw new Error("额度不足。请前往 BotGo 网站管理账户。");
    const available = await apiRequest('/models', { deviceToken: current.deviceToken });
    const selectedModel = task.model || available.defaultModel;
    if (!available.models.some(m=>m.id===selectedModel&&m.enabled&&m.agent)) throw new Error('所选模型暂不可用于 Agent。');
    if(task.reviewer==='auto_review'&&available.capabilities?.autoReview!==true)throw new Error('替我审批暂不可用：当前审核路由或计费探测未通过。输入已保留，任务未发送。');
    const runner = await ensureRuntime(selectedModel);
    if (cancelTaskStart) throw Error('任务已取消，输入已保留。');
    const history = state().load();
    let thread = history.threads.find((item) => item.id === task.threadId && item.projectPath === task.projectPath);
    if (!thread) thread = { id: crypto.randomUUID(), projectPath: task.projectPath, title: task.prompt.slice(0, 64), sessionId: "", status: "idle", messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const entry = { ...thread, model: selectedModel, title: thread.messages.length || thread.title !== '新对话' ? thread.title : task.prompt.slice(0, 64), status: "running", updatedAt: new Date().toISOString(), messages: [...thread.messages, { id: crypto.randomUUID(), role: "user", kind: "message", content: task.prompt, files: [], createdAt: new Date().toISOString() }] };
    state().save({ ...history, selectedProject: entry.projectPath, selectedThreadId: entry.id, recentProjects: [entry.projectPath, ...history.recentProjects.filter((item) => item !== entry.projectPath)], threads: [entry, ...history.threads.filter((item) => item.id !== entry.id)] });
    let lastPersisted = 0;
    activeThreadId = entry.id;
    activeTask = runner.start({
      id: entry.id,
      projectPath: entry.projectPath,
      prompt: task.prompt,
      reviewer: task.reviewer,
      plan: Boolean(task.plan),
      review: Boolean(task.review),
      input: nativeInput,
      model: selectedModel,
      permission: task.mode,
      confirmedFullAccess: task.confirmedFullAccess,
      sessionId: entry.sessionId,
      codexHome: appPaths().codexHome,
      relayOrigin: requireApiOrigin(),
      onEvent(event) {
        if (event.type === 'steered') entry.messages.push({ id: crypto.randomUUID(), role: 'user', kind: 'message', content: event.message, createdAt: new Date().toISOString() });
        if (event.type === "session") entry.sessionId = event.sessionId;
        if (['delta', 'progress'].includes(event.type)) {
          const messageId = event.itemId || crypto.randomUUID();
          let message = entry.messages.find(item => item.id === messageId);
          if (!message) { message = { id: messageId, role: 'assistant', model: selectedModel, kind: 'message', content: '', files: [], createdAt: new Date().toISOString() }; entry.messages.push(message); }
          message.content = event.type === 'delta' ? message.content + event.delta : event.message;
        }
        if (event.type === "files") entry.messages.push({ id: crypto.randomUUID(), role: "system", kind: "files", content: "变更文件", files: event.files, createdAt: new Date().toISOString() });
        if (event.type === "error") entry.messages.push({ id: crypto.randomUUID(), role: "system", kind: "error", content: event.message || "任务未能完成。", files: [], createdAt: new Date().toISOString() });
        if (["session", "progress", "files", "steered"].includes(event.type) || (event.type === "delta" && Date.now() - lastPersisted > 500)) {
          lastPersisted = Date.now();
          entry.updatedAt = new Date().toISOString();
          const snapshot = state().load();
          state().save({ ...snapshot, selectedProject: snapshot.selectedProject, selectedThreadId: snapshot.selectedThreadId, threads: [entry, ...snapshot.threads.filter((item) => item.id !== entry.id)] });
        }
        if (["completed", "stopped", "error"].includes(event.type)) {
          entry.status = event.type;
          entry.updatedAt = new Date().toISOString();
          activeTask = null;
          const latest = state().load();
          state().save({
            selectedProject: latest.selectedProject || entry.projectPath,
            selectedThreadId: latest.selectedThreadId,
            recentProjects: [entry.projectPath, ...latest.recentProjects.filter((item) => item !== entry.projectPath)],
            threads: [entry, ...latest.threads.filter((item) => item.id !== entry.id)]
          });
        }
        sendTaskEvent(event);
      }
    });
    return { id: entry.id };
    } finally { taskStarting = false; }
  });
  ipcMain.handle("runtime:open-terminal", async (_event, { projectPath, sessionId, model }) => {
    if (activeTask || taskStarting || terminalStarting || terminalRunning || updateInstalling) throw new Error("请先停止当前任务或关闭已打开的终端。");
    terminalStarting = true;
    try {
    if (!state().load().recentProjects.includes(projectPath)) throw new Error("请先选择项目。");
    const current = await credential();
    const models=await apiRequest('/models', { deviceToken: current.deviceToken });
    model=model||models.defaultModel;
    if(!models.models.some(m=>m.id===model&&m.enabled&&m.agent))throw new Error('所选模型暂不可用。');
    closeRuntime();
    await prepareRuntime();
    const issued = await apiRequest("/desktop/key", { method: "POST", deviceToken: current.deviceToken, body: { model } });
    return await openNativeTerminal({ command: nativeCommand(agentRoot), projectPath, codexHome: appPaths().codexHome, relayKey: issued.key, relayOrigin: requireApiOrigin(), model, sessionId,
      onStatus(status) {
        terminalRunning = status.state === 'running';
        if (!_event.sender.isDestroyed()) _event.sender.send('terminal:event', status);
      }
    });
    } finally { terminalStarting = false; }
  });
  ipcMain.handle('task:open-request-url', async (_event, { threadId, requestId }) => {
    if (!activeTask || threadId !== activeThreadId) throw Error('连接或授权请求已取消。');
    await shell.openExternal(activeTask.requestUrl(requestId)); return { ok: true };
  });
  ipcMain.handle('task:respond', (_event, response) => {
    if (!activeTask || response?.threadId !== activeThreadId) throw Error('Inactive request');
    return activeTask.respond(response);
  });
  ipcMain.handle('task:steer', async (_event, { threadId, text }) => {
    if (!activeTask || threadId !== activeThreadId) throw Error('当前会话没有运行中的任务。');
    await activeTask.steer(text);
    return { ok: true };
  });
  ipcMain.handle('attachments:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile', 'multiSelections'] });
    if (result.canceled) return [];
    if (result.filePaths.length > 16) throw Error('最多添加 16 个附件。');
    return result.filePaths.map(file => { const id = crypto.randomUUID(); attachmentHandles.set(id, { path: file }); return { id, name: path.basename(file) }; });
  });
  ipcMain.handle("task:stop", async () => { if (taskStarting) cancelTaskStart = true; activeTask?.stop(); return { ok: true }; });
  ipcMain.handle("account:revoke-device", async () => {
    cancelTaskStart = true; closeRuntime();
    const current = await credential();
    await apiRequest("/desktop/revoke", { method: "POST", deviceToken: current.deviceToken });
    credentials().clear();
    return { ok: true };
  });
  ipcMain.handle("account:open-page", async () => {
    await shell.openExternal(`${requireApiOrigin()}/workspace.html`);
  });
  createWindow();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { closeRuntime(); closeActiveAuthorization(); });
