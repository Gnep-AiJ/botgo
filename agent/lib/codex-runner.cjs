const { spawn } = require("node:child_process");
const path = require("node:path");
const { StringDecoder } = require("node:string_decoder");
const { runtimeEnvironment } = require("./native.cjs");
const { providerArguments } = require("./codex-config.cjs");

const sandboxFor = {
  "read-only": "read-only",
  "workspace-write": "workspace-write",
  "full-access": "danger-full-access"
};

function codexArgumentsFor(permission, prompt = "", sessionId = "") {
  if (!Object.hasOwn(sandboxFor, permission)) throw new Error("Unsupported permission mode");
  const args = ["exec", "--json", "--sandbox", sandboxFor[permission]];
  if (sessionId) args.push("resume", String(sessionId));
  if (prompt !== undefined && prompt !== null && String(prompt).trim()) args.push(String(prompt).trim());
  return args;
}

function safeMessage(value) {
  return String(value || "")
    .replace(/(?:bgk|bgdt)_[A-Za-z0-9_-]+/g, "[protected]")
    .replace(/Bearer\s+[^\s]+/gi, "[protected]")
    .replace(/(?:OPENAI|BOTGO)_[A-Z_]+\s*=\s*[^\s]+/g, "[protected]")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[protected]");
}

function normalizeCodexLine(line) {
  let payload;
  try { payload = JSON.parse(String(line)); } catch { return null; }
  if (payload?.type === "thread.started" && payload.thread_id) {
    return { type: "session", sessionId: String(payload.thread_id).slice(0, 200) };
  }
  if (payload?.type === "item.completed" && payload.item?.type === "agent_message") {
    const text = payload.item.text ?? payload.item.content ?? "";
    return text ? { type: "progress", message: safeMessage(text) } : null;
  }
  if (payload?.type === "item.completed" && payload.item?.type === "file_change") {
    const changes = Array.isArray(payload.item.changes) ? payload.item.changes : [];
    const files = changes.map((change) => String(change?.path || "")).filter(Boolean).slice(0, 100);
    return files.length ? { type: "files", files } : null;
  }
  if (payload?.type === "error") {
    return { type: "error", message: safeMessage(payload.message || payload.error || "Codex task failed") };
  }
  return null;
}

function defaultCommand({ platform = process.platform, packageRoot = path.resolve(__dirname, "..") } = {}) {
  const commandName = platform === "win32" ? "codex.cmd" : "codex";
  return path.join(packageRoot, "node_modules", ".bin", commandName);
}

function invocationFor(command, args, { platform = process.platform, execPath = process.execPath } = {}) {
  // A Windows .cmd shim cannot be spawned with shell:false (Node reports EINVAL).
  // Invoke the pinned package's local JS entry with this Node process instead of
  // enabling a shell, which also keeps prompts and paths out of command strings.
  const pathImpl = platform === "win32" ? path.win32 : path;
  const normalizedCommand = String(command).replaceAll("\\", "/").toLowerCase();
  if (platform === "win32" && pathImpl.basename(command).toLowerCase() === "codex.cmd" && normalizedCommand.includes("/node_modules/.bin/")) {
    const script = pathImpl.resolve(pathImpl.dirname(command), "..", "@openai", "codex", "bin", "codex.js");
    return { command: execPath, args: [script, ...args] };
  }
  return { command, args };
}

function createCodexRunner({ spawnImpl = spawn, command = defaultCommand(), baseEnv = process.env, platform = process.platform, execPath = process.execPath } = {}) {
  let active = null;

  function start({ projectPath, prompt, permission, codexHome, relayKey, relayOrigin, model, sessionId = "", signal, onEvent } = {}) {
    if (active) throw new Error("A Codex task is already running");
    if (typeof projectPath !== "string" || !projectPath.trim()) throw new Error("A project path is required");
    if (typeof prompt !== "string" || !prompt.trim()) throw new Error("A task prompt is required");
    if (typeof codexHome !== "string" || !codexHome.trim()) throw new Error("An isolated CODEX_HOME is required");
    if (!/^bgk_[A-Za-z0-9_-]{1,256}$/.test(String(relayKey || ""))) throw new Error("A BotGo relay key is required");

    const args = codexArgumentsFor(permission, prompt, sessionId);
    if (relayOrigin) args.push(...providerArguments(relayOrigin, model));
    const env = runtimeEnvironment(codexHome, relayKey, baseEnv);
    const invocation = invocationFor(command, args, { platform, execPath });
    const child = spawnImpl(invocation.command, invocation.args, {
      cwd: projectPath,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      signal
    });

    let buffer = "";
    let diagnostics = "";
    let failure = "";
    const decoder = new StringDecoder("utf8");
    let settled = false;
    let stopped = false;
    const events = [];
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
    const emit = (event) => { events.push(event); if (typeof onEvent === "function") onEvent(event); };
    const forward = event => { if (event?.type === "error") failure = event.message; else if (event) emit(event); };
    const consume = (chunk) => {
      buffer += Buffer.isBuffer(chunk) ? decoder.write(chunk) : String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const event = normalizeCodexLine(line);
        forward(event);
      }
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (buffer.trim()) {
        const event = normalizeCodexLine(buffer);
        forward(event);
      }
      if (active?.child === child) active = null;
      resolvePromise({ ...result, events });
    };
    emit({ type: "started" });
    child.stdout?.on("data", consume);
    // Codex diagnostics go to stderr and are intentionally not persisted or
    // echoed: they can contain paths and provider details outside the JSONL API.
    child.stderr?.on("data", chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4000); });
    child.on("error", (error) => {
      if (settled) return;
      emit({ type: "error", message: safeMessage(error?.message || "Codex failed to start") });
      finish({ exitCode: null, signal: null, error });
    });
    child.on("close", (code, closeSignal) => {
      if (settled) return;
      buffer += decoder.end();
      if (buffer.trim()) { const event = normalizeCodexLine(buffer); buffer = ""; forward(event); }
      if (stopped) emit({ type: "stopped" });
      else if (code === 0 && !failure) emit({ type: "completed" });
      else emit({ type: "error", message: safeMessage(failure || diagnostics.trim() || `Codex exited with code ${code ?? "unknown"}`) });
      finish({ exitCode: code, signal: closeSignal || null });
    });
    active = { child };
    return {
      promise,
      stop() {
        if (settled || stopped) return;
        stopped = true;
        if (platform === "win32" && Number.isInteger(child.pid)) {
          const killer = spawnImpl(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          killer.on("error", () => child.kill("SIGTERM"));
        } else child.kill("SIGTERM");
      }
    };
  }

  return { start };
}

module.exports = { codexArgumentsFor, normalizeCodexLine, createCodexRunner, defaultCommand, safeMessage, invocationFor };
