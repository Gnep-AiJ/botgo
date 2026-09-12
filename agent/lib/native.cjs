const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
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

function openNativeTerminal({ command, projectPath, codexHome, relayKey, relayOrigin, model, sessionId = "", spawnImpl = spawn }) {
  if (!fs.statSync(projectPath).isDirectory()) throw new Error("请选择有效的项目文件夹。");
  if (sessionId && !/^[A-Za-z0-9-]{1,200}$/.test(sessionId)) throw new Error("Invalid session identifier");
  const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
  const args = sessionId ? ["resume", sessionId] : [];
  args.push(...providerArguments(relayOrigin,model));
  // No credentials in command text. Literal PowerShell quoting handles spaces,
  // quotes, $, backticks and command metacharacters in user project paths.
  const script = `Set-Location -LiteralPath ${quote(projectPath)}\r\n& ${quote(command)} ${args.map(quote).join(" ")}\r\nRemove-Item Env:BOTGO_CODEX_API_KEY -ErrorAction SilentlyContinue`;
  const executable = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const child = spawnImpl(executable, ["-NoProfile", "-NoExit", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
    cwd: projectPath, env: runtimeEnvironment(codexHome, relayKey), detached: true, windowsHide: false, stdio: "ignore"
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve({ opened: true }); });
  });
}

module.exports = { nativeCommand, runtimeEnvironment, openNativeTerminal };
