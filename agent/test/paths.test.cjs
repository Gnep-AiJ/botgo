const assert = require("node:assert/strict");
const test = require("node:test");

const { agentPaths, ensureAgentPaths } = require("../lib/paths.cjs");

test("agent paths stay separate from the user's .codex directory", () => {
  const paths = agentPaths({ platform: "win32", localAppData: "C:\\Users\\alice\\AppData\\Local" });
  assert.equal(paths.root, "C:\\Users\\alice\\AppData\\Local\\BotGo\\Agent");
  assert.equal(paths.codexHome, "C:\\Users\\alice\\AppData\\Local\\BotGo\\Agent\\codex");
  assert.match(paths.stateFile, /BotGo\\Agent\\state\.json$/);
  assert.doesNotMatch(paths.codexHome, /\\\.codex$/);
});

test("ensureAgentPaths creates the managed directories", () => {
  const created = [];
  const paths = agentPaths({ platform: "win32", localAppData: "C:\\tmp\\botgo" });
  ensureAgentPaths(paths, { mkdirSync: (target, options) => created.push({ target, options }) });
  assert.deepEqual(created.map((entry) => entry.target), [paths.root, paths.codexHome]);
  assert.ok(created.every((entry) => entry.options?.recursive));
});
