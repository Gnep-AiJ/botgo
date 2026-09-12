const assert = require("node:assert/strict");
const test = require("node:test");

const {
  applyCodexUpdate,
  fetchLatestStableVersion,
  inspectCodexUpdate,
  npmInvocation,
  selectLatestStableVersion
} = require("../lib/codex-update.cjs");

test("selectLatestStableVersion uses the stable latest tag and ignores alpha", () => {
  assert.equal(
    selectLatestStableVersion({ "dist-tags": { latest: "0.154.0", alpha: "0.155.0-alpha.3.9" } }),
    "0.154.0"
  );
  assert.throws(
    () => selectLatestStableVersion({ "dist-tags": { latest: "0.155.0-alpha.1" } }),
    /stable/i
  );
});

test("inspectCodexUpdate reports a newer stable release", async () => {
  const result = await inspectCodexUpdate({
    packageRoot: "C:\\agent",
    fsImpl: {
      readFileSync() { return JSON.stringify({ version: "0.91.0" }); }
    },
    fetchImpl: async () => ({
      ok: true,
      async json() { return { "dist-tags": { latest: "0.154.0" } }; }
    })
  });
  assert.deepEqual(result, {
    currentVersion: "0.91.0",
    latestVersion: "0.154.0",
    updateAvailable: true
  });
});

test("fetchLatestStableVersion falls back to npm when direct fetch is unavailable", async () => {
  const calls = [];
  const version = await fetchLatestStableVersion({
    platform: "win32",
    execPath: "D:\\Environment\\node\\node.exe",
    fetchImpl: async () => { throw new Error("fetch failed"); },
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout: '"0.154.0"', stderr: "" };
    }
  });
  assert.equal(version, "0.154.0");
  assert.equal(calls[0].command, process.execPath);
  assert.deepEqual(calls[0].args, [
    "D:\\Environment\\node\\node_modules\\npm\\bin\\npm-cli.js",
    "view", "@openai/codex", "dist-tags.latest", "--json", "--registry", "https://registry.npmjs.org/@openai%2fcodex"
  ]);
  assert.equal(calls[0].options.shell, false);
});

test("applyCodexUpdate invokes npm with an exact stable version without a shell", () => {
  const calls = [];
  const result = applyCodexUpdate({
    packageRoot: "C:\\agent",
    latestVersion: "0.154.0",
    platform: "win32",
    execPath: "C:\\node.exe",
    fsImpl: { existsSync() { return true; } },
    spawnSyncImpl(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, error: null };
    }
  });
  assert.equal(result.status, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "C:\\node.exe");
  assert.deepEqual(calls[0].args, ["C:\\node_modules\\npm\\bin\\npm-cli.js", "install", "--save-exact", "@openai/codex@0.154.0"]);
  assert.equal(calls[0].options.cwd, "C:\\agent");
  assert.equal(calls[0].options.shell, false);
});

test("npmInvocation uses the Node npm entrypoint on Windows", () => {
  assert.deepEqual(
    npmInvocation({ platform: "win32", execPath: "C:\\node.exe", fsImpl: { existsSync() { return true; } }, args: ["--version"] }),
    { command: "C:\\node.exe", args: ["C:\\node_modules\\npm\\bin\\npm-cli.js", "--version"] }
  );
});

test("applyCodexUpdate rejects prerelease or malformed versions", () => {
  assert.throws(() => applyCodexUpdate({ packageRoot: "C:\\agent", latestVersion: "0.155.0-alpha.1" }), /stable/i);
  assert.throws(() => applyCodexUpdate({ packageRoot: "C:\\agent", latestVersion: "latest" }), /version/i);
});
