const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const readline = require("node:readline");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { agentPaths, ensureAgentPaths } = require("./paths.cjs");
const { createCredentialStore } = require("./credentials.cjs");
const { createApiClient, DEFAULT_ORIGIN } = require("./api-client.cjs");
const { createProof, callbackResultFor } = require("./auth.cjs");
const { writeCodexConfig, providerArguments } = require("./codex-config.cjs");
const { createCodexRunner, defaultCommand } = require("./codex-runner.cjs");
const { createSessionStore } = require("./session-store.cjs");
const { applyCodexUpdate, inspectCodexUpdate, readInstalledCodexVersion } = require("./codex-update.cjs");
const { nativeCommand, interactiveEnvironment } = require("./native.cjs");
const packageInfo = require("../package.json");

const PERMISSIONS = ["read-only", "workspace-write", "full-access"];

function parseArgs(argv) {
  const options = { project: process.cwd(), permission: "workspace-write", origin: process.env.BOTGO_API_ORIGIN || DEFAULT_ORIGIN, json: false, yes: false };
  const positional = [];
  const valueOptions = new Map([["--project", "project"], ["-p", "project"], ["--permission", "permission"], ["--mode", "permission"], ["--origin", "origin"], ['--model','model'], ['-m','model']]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") { positional.push(...argv.slice(index + 1)); break; }
    if (arg === "--help" || arg === "-h") { options.help = true; continue; }
    if (arg === "--version" || arg === "-v") { options.version = true; continue; }
    if (arg === "--json") { options.json = true; continue; }
    if (arg === "--check") { options.check = true; continue; }
    if (arg === "--yes" || arg === "-y") { options.yes = true; continue; }
    const key = valueOptions.get(arg);
    if (key) {
      if (index + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      options[key] = argv[++index];
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    positional.push(arg);
  }
  return { options, positional };
}

function outputLine(text, output = console.log) { output(String(text)); }

function createContext(options, overrides = {}) {
  const paths = overrides.paths ? { ...agentPaths({ platform: process.platform }), ...overrides.paths } : agentPaths({ platform: process.platform });
  ensureAgentPaths(paths, overrides.fsImpl);
  const api = overrides.api || createApiClient({ origin: options.origin, fetchImpl: overrides.fetchImpl });
  const credentialStore = overrides.credentialStore || createCredentialStore({ keytarImpl: overrides.keytarImpl });
  const sessions = overrides.sessions || createSessionStore({ filePath: paths.stateFile, fsImpl: overrides.fsImpl });
  const codexCommand = overrides.command || defaultCommand({ platform: paths.platform, packageRoot: paths.packageRoot });
  const runner = overrides.runner || createCodexRunner({
    command: codexCommand,
    spawnImpl: overrides.spawnImpl,
    baseEnv: overrides.baseEnv,
    platform: paths.platform
  });
  return { paths, api, credentialStore, sessions, runner, codexCommand, output: overrides.output || console.log, error: overrides.error || console.error };
}

async function storedCredential(context) {
  const credential = await context.credentialStore.load();
  if (!credential?.deviceToken) throw new Error("请先运行 botgo auth login");
  return credential;
}

function callbackPage(title, message) {
  const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  return `<!doctype html><meta charset="utf-8"><title>${escape(title)}</title><style>body{font:16px system-ui;max-width:560px;margin:12vh auto;padding:24px;color:#e9eef5;background:#15171b}p{color:#a9b2bd;line-height:1.6}</style><h1>${escape(title)}</h1><p>${escape(message)}</p>`;
}

function openBrowser(url) {
  const platform = process.platform;
  if (platform === "win32") {
    const child = spawn("explorer.exe", [url], { detached: true, stdio: "ignore", windowsHide: true });
    return new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
  }
  const command = platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], { detached: true, stdio: "ignore" });
  return new Promise((resolve,reject)=>{child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});});
}

async function login(context, { openBrowserImpl = openBrowser, timeoutMs = 5 * 60 * 1000, input = process.stdin } = {}) {
  const proof = createProof();
  let server, timeout, terminal, started, page;
  let settled = false, exchanging = false, resolveResult, rejectResult;
  const resultPromise = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  // A timeout may arrive while the browser launcher or an API call is still pending.
  resultPromise.catch(() => {});
  const close = () => {
    clearTimeout(timeout); terminal?.close();
    if (server?.listening) server.close();
    process.removeListener('SIGINT', cancelLogin);
  };
  const fail = error => { if (settled) return; settled = true; close(); rejectResult(error); };
  const cancelLogin = () => fail(new Error('已取消浏览器登录。重新运行 botgo 可重试。'));
  server = http.createServer(async (request, response) => {
    const send = (code, title, message) => {
      response.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
      response.end(callbackPage(title, message));
    };
    if (settled) return send(410, '授权已结束', '请返回终端重新运行 botgo。');
    if (request.method !== 'GET' || new URL(request.url || '/', 'http://127.0.0.1').pathname !== '/callback') return send(404, '页面不存在', '请使用当前登录链接。');
    let callback;
    try { callback = callbackResultFor(request.url || '/', proof.state); }
    catch { return send(400, '回调无效', '请使用本次登录打开的浏览器页面。'); }
    if (exchanging) return send(409, '正在完成登录', '请返回终端等待结果。');
    exchanging = true;
    try {
      const exchanged = await context.api.exchangeAuthorization({ authorizationId: started.authorizationId, authorizationCode: callback.code, verifier: proof.verifier });
      if (settled) return send(410, '授权已结束', '请返回终端重新登录。');
      if (!/^bgdt_[A-Za-z0-9_-]+$/.test(exchanged.deviceToken || '')) throw new Error('服务未返回有效的设备凭据。');
      // Once exchange succeeds, finish the credential write as one non-cancellable step.
      clearTimeout(timeout); process.removeListener('SIGINT', cancelLogin); terminal?.close();
      await context.credentialStore.save({ deviceToken: exchanged.deviceToken });
      settled = true; close();
      send(200, 'BotGo Agent 已登录', '可以关闭此页面并返回终端。');
      resolveResult(exchanged.account);
    } catch (error) {
      send(error?.status >= 400 && error.status < 500 ? 400 : 500, '授权未完成', '请返回终端查看错误并重新登录。');
      fail(error);
    }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    process.once('SIGINT', cancelLogin);
    timeout = setTimeout(() => fail(new Error('浏览器授权已超时。重新运行 botgo 可重试。')), timeoutMs);
    started = await Promise.race([context.api.startAuthorization({ deviceLabel: `BotGo Agent CLI (${os.hostname()})`.slice(0, 80), verifier: proof.verifier }), resultPromise]);
    if (settled) return await resultPromise;
    const callback = `http://127.0.0.1:${server.address().port}/callback`;
    page = new URL('/desktop-authorize.html', context.api.origin);
    page.searchParams.set('request', started.authorizationId); page.searchParams.set('state', proof.state);
    page.searchParams.set('callback', callback); page.searchParams.set('client', 'agent');
    const reopen = async () => {
      try { await Promise.race([openBrowserImpl(page.toString()), resultPromise]); }
      catch (error) { if (settled) throw error; outputLine('无法自动打开浏览器，请使用下方链接。', context.output); }
    };
    if (!settled) {
      outputLine('请在浏览器中登录并确认授权；完成后自动返回终端。', context.output);
      outputLine(`登录链接：${page}`, context.output);
      outputLine('按 Ctrl+C 取消；按 Enter 重新打开浏览器。', context.output);
      if (input?.isTTY) {
        terminal = readline.createInterface({ input, terminal: false });
        terminal.on('line', () => { if (!settled && !exchanging) reopen().catch(() => {}); });
        terminal.on('SIGINT', cancelLogin);
      }
      // Browser launch can hang; the manual link and cancellation stay available.
      reopen().catch(() => {});
    }
    const account = await resultPromise;
    outputLine(`已登录 ${account?.email || 'BotGo 账户'}。`, context.output);
    return account;
  } catch (error) {
    fail(error);
    // Local cleanup must not wait on a failed remote cancellation endpoint.
    if (started?.authorizationId) Promise.resolve().then(() => context.api.cancelAuthorization({ authorizationId: started.authorizationId, verifier: proof.verifier })).catch(() => {});
    throw error;
  } finally { close(); }
}

function accountSummary(account) {
  const yuan = Number.isFinite(account.balanceCents) ? account.balanceCents / 100 : Number(account.credits);
  return `${account.email} · 余额 ${Number.isFinite(yuan) ? new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(yuan) : '暂不可用'}`;
}

async function authCommand(context, action) {
  if (action === "login") return login(context);
  if (action === "status") {
    try {
      const credential = await storedCredential(context);
      const account = await context.api.account(credential.deviceToken);
      outputLine(`${account.account.email} · ${account.account.credits} credits`, context.output);
      return account;
    } catch (error) {
      if (/请先运行|credential/i.test(error.message || "")) {
        outputLine("未登录 BotGo。", context.output);
        return { authenticated: false };
      }
      throw error;
    }
  }
  if (action === "logout") {
    const credential = await context.credentialStore.load();
    if (credential?.deviceToken) {
      try { await context.api.revoke(credential.deviceToken); } catch (error) { if (error.status !== 401 && error.status !== 404) throw error; }
    }
    await context.credentialStore.clear();
    outputLine("已退出 BotGo Agent。", context.output);
    return { ok: true };
  }
  throw new Error("用法：botgo auth login|status|logout");
}

async function accountCommand(context) {
  const credential = await storedCredential(context);
  const result = await context.api.account(credential.deviceToken);
  outputLine(`${result.account.email} · ${result.account.plan || "Free"} · ${result.account.credits} credits`, context.output);
  return result;
}

async function confirmFullAccess(options, context) {
  if (options.permission !== "full-access") return true;
  if (options.yes) return true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("full-access requires --yes when stdin is not interactive");
  const answer = await new Promise((resolve) => {
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    input.question("full-access 可修改项目外文件，继续？[y/N] ", (value) => { input.close(); resolve(value); });
  });
  if (!/^y(es)?$/i.test(answer.trim())) throw new Error("已取消 full-access 任务");
  return true;
}

function ensurePermission(value) {
  if (!PERMISSIONS.includes(value)) throw new Error(`permission 必须是 ${PERMISSIONS.join(", ")}`);
  return value;
}

function ensureProject(projectPath) {
  const resolved = path.resolve(projectPath || process.cwd());
  let stat;
  try { stat = fs.statSync(resolved); } catch { throw new Error(`项目目录不存在：${resolved}`); }
  if (!stat.isDirectory()) throw new Error(`项目路径不是目录：${resolved}`);
  return resolved;
}

async function executeTask(context, { projectPath, prompt, permission, session = null, options }) {
  options = { permission, yes: false, json: false, ...(options || {}) };
  ensurePermission(permission);
  await confirmFullAccess(options, context);
  if (context.codexCommand && !fs.existsSync(context.codexCommand)) throw new Error("本地 Codex CLI 未安装，请先在 agent 目录运行 npm install");
  writeCodexConfig({ codexHome: context.paths.codexHome, relayOrigin: context.api.origin });
  const credential = await storedCredential(context);
  const account = await context.api.account(credential.deviceToken);
  if (!Number.isFinite(account.account?.credits) || account.account.credits <= 0) throw new Error("BotGo 余额不足，请先充值");
  const available=await context.api.models();
  const selectedModel=options.model||session?.model||available.defaultModel;
  if(!available.models.some(m=>m.id===selectedModel&&m.enabled&&m.agent))throw new Error('所选模型暂不可用于 Agent。');
  const issued = await context.api.issueKey(credential.deviceToken);
  if (!/^bgk_[A-Za-z0-9_-]{1,256}$/.test(issued.key || "")) throw new Error("BotGo 未返回有效的执行凭据");
  const current = session || {
    id: crypto.randomUUID(), projectPath, title: prompt.slice(0, 120), codexSessionId: "", status: "idle", messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  current.projectPath = projectPath;
  current.model=selectedModel;
  current.title = current.messages?.length ? current.title : prompt.slice(0, 120);
  current.status = "running";
  current.messages = Array.isArray(current.messages) ? current.messages : [];
  current.messages.push({ id: crypto.randomUUID(), role: "user", kind: "message", content: prompt, files: [], createdAt: new Date().toISOString() });
  context.sessions.upsert(current);
  outputLine(`session ${current.id}`, context.output);
  let task;
  try {
    task = context.runner.start({
      projectPath,
      prompt,
      permission,
      codexHome: context.paths.codexHome,
      relayKey: issued.key,
      relayOrigin: context.api.origin,
      model: selectedModel,
      sessionId: current.codexSessionId,
      onEvent(event) {
        if (event.type === "session") current.codexSessionId = event.sessionId;
        if (event.type === "progress") current.messages.push({ id: crypto.randomUUID(), role: "assistant", model:selectedModel, kind: "progress", content: event.message, files: [], createdAt: new Date().toISOString() });
        if (event.type === "files") current.messages.push({ id: crypto.randomUUID(), role: "system", kind: "files", content: "文件变更", files: event.files, createdAt: new Date().toISOString() });
        if (event.type === "error") current.messages.push({ id: crypto.randomUUID(), role: "system", kind: "error", content: event.message, files: [], createdAt: new Date().toISOString() });
        if (["completed", "stopped", "error"].includes(event.type)) current.status = event.type;
        current.updatedAt = new Date().toISOString();
        context.sessions.upsert(current);
        if (options.json) outputLine(JSON.stringify(event), context.output);
        if (!options.json && event.type === "progress") outputLine(event.message, context.output);
        if (!options.json && event.type === "files") outputLine(`文件变更：${event.files.join(", ")}`, context.output);
        if (!options.json && event.type === "error") outputLine(`错误：${event.message}`, context.error);
      }
    });
  } catch (error) {
    current.status = "error";
    current.updatedAt = new Date().toISOString();
    context.sessions.upsert(current);
    throw error;
  }
  const stopOnInterrupt = () => task.stop();
  process.once("SIGINT", stopOnInterrupt);
  try {
    return { session: current, result: await task.promise };
  } finally {
    process.removeListener("SIGINT", stopOnInterrupt);
  }
}

async function runCommand(context, options, positional, resume = false) {
  if (resume && !positional[0]) throw new Error("resume 需要 session-id");
  let prompt = (resume ? positional.slice(1) : positional).join(" ").trim();
  if (!prompt && process.stdin.isTTY) {
    prompt = await new Promise((resolve) => {
      const input = readline.createInterface({ input: process.stdin, output: process.stdout });
      input.question("任务> ", (value) => { input.close(); resolve(value.trim()); });
    });
  }
  if (!prompt) throw new Error("请提供任务，例如：botgo run --project . 修复测试");
  const session = resume ? context.sessions.get(positional[0]) : null;
  if (resume && !session) throw new Error(`找不到会话：${positional[0]}`);
  const projectPath = resume ? ensureProject(session.projectPath) : ensureProject(options.project);
  if (resume && !session.codexSessionId) throw new Error("该会话还没有可恢复的 Codex session");
  return executeTask(context, { projectPath, prompt, permission: options.permission, session, options });
}

function printSession(session, output = console.log) {
  output(`${session.id}  ${session.status}  ${session.title}  ${session.projectPath}`);
}

async function sessionsCommand(context, action, positional) {
  if (action === "list") {
    const sessions = context.sessions.list();
    if (!sessions.length) outputLine("暂无会话。", context.output);
    else sessions.forEach((session) => printSession(session, context.output));
    return sessions;
  }
  if (action === "show") {
    const session = context.sessions.get(positional[0]);
    if (!session) throw new Error(`找不到会话：${positional[0] || ""}`);
    outputLine(JSON.stringify(session, null, 2), context.output);
    return session;
  }
  throw new Error("用法：botgo sessions list|show <session-id>");
}

async function codexUpdateCommand({ packageRoot = path.resolve(__dirname, ".."), options = {}, output = console.log, fetchImpl, fsImpl, spawnSyncImpl } = {}) {
  const report = await inspectCodexUpdate({ packageRoot, fetchImpl, fsImpl });
  output(`Codex CLI ${report.currentVersion}（最新稳定版 ${report.latestVersion}）`);
  if (!report.updateAvailable) {
    output("已是最新稳定版。");
    return report;
  }
  if (options.check) {
    output("检测到可用更新；运行 botgo update 应用更新。");
    return report;
  }
  output(`正在升级 Codex CLI ${report.currentVersion} -> ${report.latestVersion}…`);
  applyCodexUpdate({ packageRoot, latestVersion: report.latestVersion, spawnSyncImpl });
  const updatedVersion = readInstalledCodexVersion({ packageRoot, fsImpl });
  if (updatedVersion !== report.latestVersion) throw new Error(`Codex update finished at unexpected version ${updatedVersion}`);
  output(`Codex CLI 已更新到 ${updatedVersion}。`);
  return { ...report, updatedVersion };
}

function help(output = console.log) {
  output(`BotGo Agent CLI\n\n用法：\n  botgo auth login|status|logout\n  botgo account\n  botgo update [--check]\n  botgo codex -- <原生参数>\n  botgo run [--project <dir>] [--permission read-only|workspace-write|full-access] <任务>\n  botgo resume <session-id> [--permission ...] <后续任务>\n  botgo sessions list|show <session-id>\n\n默认通过 BotGo 账户计费，Codex 使用隔离的 CODEX_HOME。`);
}

function version(output = console.log) { output(packageInfo.version); }

async function main(argv = process.argv.slice(2), overrides = {}) {
  const { options, positional } = parseArgs(argv);
  if (options.version) { version(overrides.output || console.log); return { ok: true, version: packageInfo.version }; }
  const interactive = overrides.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (options.help || (!positional.length && !interactive) || positional[0] === "help") { help(overrides.output || console.log); return { ok: true }; }
  const command = positional[0] || 'codex';
  if (command === "update") {
    return codexUpdateCommand({
      packageRoot: path.resolve(__dirname, ".."),
      options,
      output: overrides.output || console.log,
      fetchImpl: overrides.fetchImpl,
      fsImpl: overrides.fsImpl,
      spawnSyncImpl: overrides.spawnSyncImpl
    });
  }
  const context = createContext(options, overrides);
  if (command === "codex") {
    let credential = await context.credentialStore.load();
    if (credential?.deviceToken) {
      try { await context.api.account(credential.deviceToken); }
      catch(error) { if(error.status!==401&&error.status!==403)throw error;credential=null; }
    }
    if (!credential?.deviceToken) {
      if (!interactive) throw new Error('请在交互终端运行 botgo auth login');
      await (overrides.loginImpl || login)(context);
      credential=await storedCredential(context);
    }
    const available = await context.api.models();
    const model=options.model || available.defaultModel;
    if(!available.models.some(m=>m.id===model&&m.enabled&&m.agent))throw new Error('所选模型暂不可用于 Agent。');
    writeCodexConfig({ codexHome: context.paths.codexHome, relayOrigin: context.api.origin });
    const issued = await context.api.issueKey(credential.deviceToken);
    const child = (overrides.spawnImpl || spawn)(nativeCommand(context.paths.packageRoot), [...positional.slice(1), ...providerArguments(context.api.origin,model)], {
      cwd: ensureProject(options.project), env: interactiveEnvironment(context.paths.codexHome, issued.key, overrides.baseEnv || process.env, { platform: context.paths.platform, isTTY: interactive }), stdio: "inherit", windowsHide: false
    });
    return new Promise((resolve, reject) => { child.once("error", reject); child.once("close", code => { process.exitCode = code ?? 1; resolve({ exitCode: code ?? 1 }); }); });
  }
  if (command === "auth") return authCommand(context, positional[1]);
  if (command === "account") return accountCommand(context);
  if (command === "run") return runCommand(context, options, positional.slice(1), false);
  if (command === "resume") return runCommand(context, options, positional.slice(1), true);
  if (command === "sessions") return sessionsCommand(context, positional[1], positional.slice(2));
  throw new Error(`未知命令：${command}`);
}

module.exports = { main, parseArgs, createContext, executeTask, ensurePermission, ensureProject, openBrowser, login, authCommand, codexUpdateCommand };
