const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require('node:crypto');
const { providerArguments } = require("./codex-config.cjs");

function nativeCommand(packageRoot = path.resolve(__dirname, "..")) {
  const command = path.join(packageRoot, "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe");
  if (!fs.existsSync(command)) throw new Error("BotGo 运行环境不完整，请重新运行官网安装命令。");
  return command;
}

function runtimeEnvironment(codexHome, relayKey, base = process.env) {
  if (!path.isAbsolute(codexHome)) throw new Error("CODEX_HOME must be absolute");
  if (!/^bgk_[A-Za-z0-9_-]{1,256}$/.test(relayKey || "")) throw new Error("Invalid BotGo execution credential");
  const env = { ...base };
  for (const name of Object.keys(env)) {
    if (/^(OPENAI_API_KEY|CODEX_API_KEY|OPENAI_BASE_URL|OPENAI_ORG_ID|CODEX_HOME|BOTGO_CODEX_API_KEY)$/i.test(name)) delete env[name];
  }
  return { ...env, CODEX_HOME: codexHome, BOTGO_CODEX_API_KEY: relayKey };
}

function interactiveEnvironment(codexHome, relayKey, base = process.env, { platform = process.platform, isTTY = false } = {}) {
  const env = runtimeEnvironment(codexHome, relayKey, base);
  if (platform === 'win32' && isTTY && String(env.TERM).toLowerCase() === 'dumb') env.TERM = 'xterm-256color';
  return env;
}

function openNativeTerminal({ command, projectPath, codexHome, relayKey, relayOrigin, model, sessionId = "", spawnImpl = spawn, onStatus = () => {}, readyTimeoutMs = 20000, settleMs = 1000 }) {
  if (!fs.statSync(projectPath).isDirectory()) throw new Error("请选择有效的项目文件夹。");
  if (sessionId && !/^[A-Za-z0-9-]{1,200}$/.test(sessionId)) throw new Error("Invalid session identifier");
  const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  const args = sessionId ? ["resume", sessionId] : [];
  args.push(...providerArguments(relayOrigin,model));
  // No credentials in command text. Literal PowerShell quoting handles spaces,
  // quotes, $, backticks and command metacharacters in user project paths.
  const eventName = `Local\\BotGoConsole-${randomUUID()}`;
  const script = `$ErrorActionPreference = 'Stop'\r\n$code = 1\r\ntry {\r\nif ([Console]::IsInputRedirected -or [Console]::IsOutputRedirected) { throw 'Interactive console unavailable' }\r\nif ($env:TERM -eq 'dumb') { $env:TERM = 'xterm-256color' }\r\nSet-Location -LiteralPath ${quote(projectPath)}\r\n$ready = [Threading.EventWaitHandle]::OpenExisting(${quote(eventName)})\r\n$null = $ready.Set(); $ready.Dispose()\r\n& ${quote(command)} ${args.map(quote).join(" ")}\r\n$code = $LASTEXITCODE\r\n} finally { Remove-Item Env:BOTGO_CODEX_API_KEY -ErrorAction SilentlyContinue }\r\nexit $code`;
  const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const helper = fs.readFileSync(path.join(__dirname, 'windows-console.ps1'), 'utf8') + `\r\nexit [BotGoConsole]::Run(${quote(executable)}, ${quote(Buffer.from(script, 'utf16le').toString('base64'))}, ${quote(eventName)})`;
  return new Promise((resolve, reject) => {
    let child, timer, grace, settled = false, ready = false, buffer = '';
    const fail = error => {
      clearTimeout(timer); clearTimeout(grace);
      onStatus({ state: 'error', message: error.message });
      if (!settled) { settled = true; reject(error); }
    };
    try {
      child = spawnImpl(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(helper, 'utf16le').toString('base64')], {
        cwd: projectPath, env: runtimeEnvironment(codexHome, relayKey), windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
      });
    } catch (error) { fail(error); return; }
    timer = setTimeout(() => fail(new Error('终端未在时限内确认交互输入输出，请检查已打开的窗口后重试。')), readyTimeoutMs);
    child.once('error', fail);
    child.stdout.on('data', chunk => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) {
        if (line === 'CREATED' && !settled) onStatus({ state: 'starting', message: '已创建窗口，正在检查控制台…' });
        if (line === 'READY' && !ready && !settled) {
          ready = true;
          grace = setTimeout(() => {
            if (settled) return;
            clearTimeout(timer); settled = true;
            onStatus({ state: 'running', message: '交互控制台已连接，请在终端中操作。' });
            resolve({ opened: true, consoleReady: true });
          }, settleMs);
        }
      }
    });
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(grace);
      if (!settled) fail(new Error(`终端启动失败或立即退出（退出码 ${code ?? '未知'}）。`));
      else onStatus({ state: code === 0 ? 'idle' : 'error', message: code === 0 ? '终端已退出。' : `终端异常退出（退出码 ${code ?? '未知'}）。` });
    });
  });
}

module.exports = { nativeCommand, runtimeEnvironment, interactiveEnvironment, openNativeTerminal };
