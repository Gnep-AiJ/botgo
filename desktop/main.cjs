const { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } = require("electron");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const http = require("node:http");
const path = require("node:path");
const fs = require("node:fs");
const { createCredentialStore } = require("./lib/credential-store.cjs");
const { createLocalStateStore } = require("./lib/local-state.cjs");
const { prepareBotGoConfig, restoreOriginalConfig } = require("./lib/codex-config.cjs");
const { createTaskRunner } = require("./lib/task-runner.cjs");
const { callbackResultFor, createWebAuthorizationProof } = require("./lib/web-auth.cjs");

const execFileAsync = promisify(execFile);
const CODEX_CLI_VERSION = "0.91.0";
function buildTimeApiOrigin() {
  try { return require("./runtime-config.cjs").apiOrigin || ""; } catch { return ""; }
}
const pagesOrigin = (process.env.BOTGO_API_ORIGIN || buildTimeApiOrigin() || "").replace(/\/$/, "");
let mainWindow;
let activeTask;
let activeAuthorization;

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
    codexConfig: path.join(app.getPath("home"), ".codex", "config.toml")
  };
}

function credentials() { return createCredentialStore({ filePath: appPaths().credentials, safeStorage }); }
function state() { return createLocalStateStore({ filePath: appPaths().history }); }
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
  const selectedProject = projectPath.trim();
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
    headers: {
      "content-type": "application/json",
      ...(deviceToken ? { authorization: `Bearer ${deviceToken}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "BotGo service is unavailable.");
  return payload;
}

async function credential() {
  const value = credentials().load();
  if (!value?.deviceToken) throw new Error("请先登录。");
  return value;
}

async function codexIsAvailable() {
  try { await execFileAsync("codex", ["--version"], { windowsHide: true }); return true; } catch { return false; }
}

async function prepareRuntime(confirmConfigReplace) {
  const paths = appPaths();
  if (!(await codexIsAvailable())) {
    await execFileAsync("npm", ["install", "--global", `@openai/codex@${CODEX_CLI_VERSION}`], { windowsHide: false });
  }
  const prepared = prepareBotGoConfig({
    configPath: paths.codexConfig,
    backupDirectory: paths.backups,
    relayUrl: requireApiOrigin(),
    confirmed: confirmConfigReplace
  });
  fs.writeFileSync(paths.metadata, JSON.stringify({ backupPath: prepared.backupPath || null }), "utf8");
  return { ready: true, existingConfigurationBackedUp: Boolean(prepared.backupPath) };
}

function createWindow() {
  app.setAppUserModelId("com.botgo.desktop");
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 650,
    backgroundColor: "#07182d",
    icon: path.join(__dirname, "assets", "botgo-desktop.ico"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile("index.html");
}

app.whenReady().then(() => {
  ipcMain.handle("auth:start-web-authorization", async () => startBrowserAuthorization());
  ipcMain.handle("auth:cancel-web-authorization", async () => cancelBrowserAuthorization());
  ipcMain.handle("account:get", async () => {
    const current = await credential();
    return apiRequest("/desktop/account", { deviceToken: current.deviceToken });
  });
  ipcMain.handle("history:get", async () => state().load());
  ipcMain.handle("project:choose", async () => {
    const selected = await dialog.showOpenDialog(mainWindow, { properties: ["openDirectory", "createDirectory"] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return selected.filePaths[0];
  });
  ipcMain.handle("project:remember", async (_event, projectPath) => rememberProject(projectPath));
  ipcMain.handle("thread:create", async (_event, projectPath) => createThread(projectPath));
  ipcMain.handle("thread:select", async (_event, threadId) => selectThread(threadId));
  ipcMain.handle("runtime:prepare", async (_event, { confirmConfigReplace }) => prepareRuntime(confirmConfigReplace));
  ipcMain.handle("runtime:restore-config", async () => {
    const metadata = JSON.parse(fs.readFileSync(appPaths().metadata, "utf8"));
    restoreOriginalConfig({ configPath: appPaths().codexConfig, backupPath: metadata.backupPath });
    return { ok: true };
  });
  ipcMain.handle("task:start", async (_event, task) => {
    if (activeTask) throw new Error("已有任务正在运行。");
    const current = await credential();
    const account = await apiRequest("/desktop/account", { deviceToken: current.deviceToken });
    if (!Number.isFinite(account.account?.credits) || account.account.credits < 1) throw new Error("额度不足。请前往 BotGo 网站管理账户。");
    const issued = await apiRequest("/desktop/key", { method: "POST", deviceToken: current.deviceToken });
    credentials().save({ ...current, desktopKey: issued.key });
    const history = state().load();
    let thread = history.threads.find((item) => item.id === task.threadId && item.projectPath === task.projectPath);
    if (!thread) thread = { id: crypto.randomUUID(), projectPath: task.projectPath, title: task.prompt.slice(0, 64), sessionId: "", status: "idle", messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const entry = { ...thread, title: thread.messages.length ? thread.title : task.prompt.slice(0, 64), status: "running", updatedAt: new Date().toISOString(), messages: [...thread.messages, { id: crypto.randomUUID(), role: "user", kind: "message", content: task.prompt, files: [], createdAt: new Date().toISOString() }] };
    state().save({ ...history, selectedProject: entry.projectPath, selectedThreadId: entry.id, recentProjects: [entry.projectPath, ...history.recentProjects.filter((item) => item !== entry.projectPath)], threads: [entry, ...history.threads.filter((item) => item.id !== entry.id)] });
    const runner = createTaskRunner({ spawn });
    activeTask = runner.start({
      id: entry.id,
      projectPath: entry.projectPath,
      prompt: entry.prompt,
      mode: task.mode,
      confirmedFullAccess: task.confirmedFullAccess,
      sessionId: entry.sessionId,
      environment: { BOTGO_CODEX_API_KEY: issued.key },
      onEvent(event) {
        if (event.type === "session") entry.sessionId = event.sessionId;
        if (event.type === "progress" && event.message) entry.messages.push({ id: crypto.randomUUID(), role: "assistant", kind: "message", content: event.message, files: [], createdAt: new Date().toISOString() });
        if (event.type === "files") entry.messages.push({ id: crypto.randomUUID(), role: "system", kind: "files", content: "变更文件", files: event.files, createdAt: new Date().toISOString() });
        if (event.type === "error") entry.messages.push({ id: crypto.randomUUID(), role: "system", kind: "error", content: event.message || "任务未能完成。", files: [], createdAt: new Date().toISOString() });
        if (["session", "progress", "files"].includes(event.type)) {
          entry.updatedAt = new Date().toISOString();
          const snapshot = state().load();
          state().save({ ...snapshot, selectedProject: entry.projectPath, selectedThreadId: entry.id, threads: [entry, ...snapshot.threads.filter((item) => item.id !== entry.id)] });
        }
        if (["completed", "stopped", "error"].includes(event.type)) {
          entry.status = event.type;
          entry.updatedAt = new Date().toISOString();
          activeTask = null;
          const latest = state().load();
          state().save({
            selectedProject: latest.selectedProject || entry.projectPath,
            selectedThreadId: entry.id,
            recentProjects: [entry.projectPath, ...latest.recentProjects.filter((item) => item !== entry.projectPath)],
            threads: [entry, ...latest.threads.filter((item) => item.id !== entry.id)]
          });
        }
        sendTaskEvent(event);
      }
    });
    return { id: entry.id };
  });
  ipcMain.handle("task:stop", async () => { activeTask?.stop(); return { ok: true }; });
  ipcMain.handle("account:revoke-device", async () => {
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
app.on("before-quit", () => { closeActiveAuthorization(); });
