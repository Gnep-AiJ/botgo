const { codexArgumentsFor } = require("./mode.cjs");

function safeMessage(value) {
  return String(value || "")
    .replace(/(?:bgk|bgdt)_[A-Za-z0-9_-]+/g, "[protected]")
    .replace(/Bearer\s+[^\s]+/gi, "[protected]")
    .replace(/(?:OPENAI|BOTGO)_[A-Z_]+\s*=\s*[^\s]+/g, "[protected]")
    .slice(0, 1200);
}

function eventFromLine(line) {
  let payload;
  try { payload = JSON.parse(line); } catch { return null; }
  if (payload.type === "item.completed" && payload.item?.type === "agent_message") {
    return { type: "progress", message: safeMessage(payload.item.text) };
  }
  if (payload.type === "item.completed" && payload.item?.type === "file_change") {
    const files = Array.isArray(payload.item.changes) ? payload.item.changes.map((change) => String(change.path || "")).filter(Boolean).slice(0, 100) : [];
    return files.length ? { type: "files", files } : null;
  }
  if (payload.type === "thread.started" && payload.thread_id) return { type: "session", sessionId: String(payload.thread_id).slice(0, 200) };
  if (payload.type === "error") return { type: "error", message: safeMessage(payload.message || "任务未能完成。") };
  return null;
}

function createTaskRunner({ spawn }) {
  let active = null;

  function start({ id, projectPath, prompt, mode, environment, onEvent, confirmedFullAccess = false, sessionId = "" }) {
    if (active) throw new Error("A task is already running");
    if (mode === "full-access" && !confirmedFullAccess) throw new Error("Full access requires confirmation");
    if (typeof projectPath !== "string" || !projectPath.trim() || typeof prompt !== "string" || !prompt.trim()) throw new Error("A project and task are required");
    const baseArgs = codexArgumentsFor(mode);
    const args = sessionId ? [...baseArgs, "resume", sessionId, prompt.trim()] : [...baseArgs, prompt.trim()];
    const child = spawn("codex", args, {
      cwd: projectPath,
      env: { ...process.env, ...environment },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let buffer = "";
    let stopped = false;
    const notify = (event) => onEvent(event);
    notify({ type: "started" });
    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      for (const line of lines) {
        const event = eventFromLine(line);
        if (event) notify(event);
      }
    });
    child.stderr.on("data", () => {});
    child.on("error", () => {
      if (!stopped) notify({ type: "error", message: "任务未能启动。" });
    });
    child.on("close", (code) => {
      if (active?.id === id) active = null;
      if (stopped) notify({ type: "stopped" });
      else if (code === 0) notify({ type: "completed" });
      else notify({ type: "error", message: "任务未能完成。" });
    });
    active = { id, child };
    return {
      stop() {
        if (active?.id !== id || stopped) return;
        stopped = true;
        child.kill("SIGTERM");
      }
    };
  }

  return { start };
}

module.exports = { createTaskRunner, eventFromLine };
