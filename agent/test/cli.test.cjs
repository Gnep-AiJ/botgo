const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { parseArgs, executeTask, codexUpdateCommand } = require("../lib/cli.cjs");

test("CLI parses project, permission and a multi-word prompt", () => {
  const parsed = parseArgs(["run", "--project", "C:\\repo", "--permission", "read-only", "inspect", "the", "tree"]);
  assert.deepEqual(parsed.options, { project: "C:\\repo", permission: "read-only", origin: process.env.BOTGO_API_ORIGIN || "https://botgo.win", json: false, yes: false });
  assert.deepEqual(parsed.positional, ["run", "inspect", "the", "tree"]);
});

test("CLI parses the stable Codex update check", () => {
  const parsed = parseArgs(["update", "--check"]);
  assert.equal(parsed.options.check, true);
  assert.deepEqual(parsed.positional, ["update"]);
});

test("codexUpdateCommand reports a newer stable release without installing in check mode", async () => {
  const output = [];
  const report = await codexUpdateCommand({
    packageRoot: "C:\\agent",
    options: { check: true },
    output(value) { output.push(String(value)); },
    fsImpl: { readFileSync() { return JSON.stringify({ version: "0.91.0" }); } },
    fetchImpl: async () => ({ ok: true, async json() { return { "dist-tags": { latest: "0.154.0" } }; } }),
    spawnSyncImpl() { throw new Error("check mode must not install"); }
  });
  assert.equal(report.updateAvailable, true);
  assert.match(output.join("\n"), /0\.91\.0.*0\.154\.0/s);
});

test("executeTask issues a relay key and records a resumable session", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "botgo-agent-test-"));
  const events = [];
  const stored = new Map();
  const context = {
    paths: { codexHome: path.join(root, "codex") },
    credentialStore: { async load() { return { deviceToken: "bgdt_device" }; } },
    api: {
      origin: "https://botgo.win",
      async account() { return { account: { credits: 3 } }; },
      async models() { return {defaultModel:'gpt-5.6-sol',models:[{id:'gpt-5.6-sol',enabled:true,agent:true}]}; },
      async issueKey(_deviceToken, model) { assert.equal(model, 'gpt-5.6-sol'); return { key: "bgk_v2_relay" }; }
    },
    sessions: {
      upsert(value) { stored.set(value.id, JSON.parse(JSON.stringify(value))); return value; },
      get(id) { return stored.get(id) || null; }
    },
    runner: {
      start(options) {
        events.push(options);
        options.onEvent({ type: "session", sessionId: "codex-session" });
        options.onEvent({ type: "progress", message: "done" });
        options.onEvent({ type: "completed" });
        return { promise: Promise.resolve({ exitCode: 0, events: [] }), stop() {} };
      }
    },
    output() {},
    error() {}
  };
  const result = await executeTask(context, {
    projectPath: root,
    prompt: "inspect",
    permission: "read-only",
    options: { permission: "read-only", yes: false }
  });
  assert.equal(events[0].relayKey, "bgk_v2_relay");
  assert.equal(events[0].codexHome, path.join(root, "codex"));
  assert.equal(result.session.codexSessionId, "codex-session");
  assert.equal(result.session.status, "completed");
  assert.equal(stored.get(result.session.id).messages.some((message) => message.content === "done"), true);
  assert.match(fs.readFileSync(path.join(root, "codex", "config.toml"), "utf8"), /BOTGO_CODEX_API_KEY/);
  fs.rmSync(root, { recursive: true, force: true });
});
