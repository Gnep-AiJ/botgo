const assert = require("node:assert/strict");
const test = require("node:test");

const {
  codexArgumentsFor,
  normalizeCodexLine,
  createCodexRunner,
  invocationFor
} = require("../lib/codex-runner.cjs");

test("the bundled Windows shim is invoked through Node without a shell", () => {
  const invocation = invocationFor("C:\\agent\\node_modules\\.bin\\codex.cmd", ["--version"], { platform: "win32", execPath: "C:\\node.exe" });
  assert.equal(invocation.command, "C:\\node.exe");
  assert.deepEqual(invocation.args, ["C:\\agent\\node_modules\\@openai\\codex\\bin\\codex.js", "--version"]);
});

test("permission modes map to the three Codex sandbox policies", () => {
  assert.deepEqual(codexArgumentsFor("read-only", "do work"), ["exec", "--json", "--sandbox", "read-only", "do work"]);
  assert.deepEqual(codexArgumentsFor("workspace-write", "do work"), ["exec", "--json", "--sandbox", "workspace-write", "do work"]);
  assert.deepEqual(codexArgumentsFor("full-access", "do work"), ["exec", "--json", "--sandbox", "danger-full-access", "do work"]);
  assert.throws(() => codexArgumentsFor("unknown", "do work"), /permission/i);
});

test("resume uses the Codex session id after the sandbox arguments", () => {
  assert.deepEqual(
    codexArgumentsFor("workspace-write", "follow up", "thread-123"),
    ["exec", "--json", "--sandbox", "workspace-write", "resume", "thread-123", "follow up"]
  );
});

test("Codex JSON lines normalize progress, file and session events", () => {
  assert.deepEqual(normalizeCodexLine(JSON.stringify({ type: "thread.started", thread_id: "thread-1" })), { type: "session", sessionId: "thread-1" });
  assert.deepEqual(normalizeCodexLine(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } })), { type: "progress", message: "done" });
  assert.deepEqual(normalizeCodexLine(JSON.stringify({ type: "item.completed", item: { type: "file_change", changes: [{ path: "src/app.js" }] } })), { type: "files", files: ["src/app.js"] });
  assert.equal(normalizeCodexLine("not-json"), null);
});

test("runner injects BotGo credentials and removes direct provider keys", async () => {
  const calls = [];
  const listeners = [];
  const child = {
    stdout: { on(event, listener) { listeners.push(["stdout", event, listener]); } },
    stderr: { on(event, listener) { listeners.push(["stderr", event, listener]); } },
    on(event, listener) { listeners.push(["child", event, listener]); },
    kill(signal) { calls.push(["kill", signal]); }
  };
  const runner = createCodexRunner({
    spawnImpl(command, args, options) { calls.push([command, args, options]); return child; },
    command: "codex-local",
    baseEnv: { OPENAI_API_KEY: "secret", CODEX_API_KEY: "secret2", PATH: "path" }
  });
  const task = runner.start({ projectPath: "C:\\project", prompt: "inspect", permission: "read-only", sessionId: "", codexHome: "C:\\agent\\codex", relayKey: "bgk_test" });
  const spawnCall = calls[0];
  assert.equal(spawnCall[0], "codex-local");
  assert.deepEqual(spawnCall[1], ["exec", "--json", "--sandbox", "read-only", "inspect"]);
  assert.equal(spawnCall[2].cwd, "C:\\project");
  assert.equal(spawnCall[2].env.CODEX_HOME, "C:\\agent\\codex");
  assert.equal(spawnCall[2].env.BOTGO_CODEX_API_KEY, "bgk_test");
  assert.equal(spawnCall[2].env.OPENAI_API_KEY, undefined);
  assert.equal(spawnCall[2].env.CODEX_API_KEY, undefined);
  listeners.find((entry) => entry[0] === "stdout" && entry[1] === "data");
  const close = listeners.find((entry) => entry[0] === "child" && entry[1] === "close")[2];
  close(0);
  const result = await task.promise;
  assert.equal(result.exitCode, 0);
  assert.equal(calls.some((entry) => entry[0] === "kill"), false);
});
