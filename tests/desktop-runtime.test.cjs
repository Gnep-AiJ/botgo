const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { codexArgumentsFor } = require("../agent/lib/codex-runner.cjs");
const { createLocalStateStore } = require("../desktop/lib/local-state.cjs");
const { createCredentialStore } = require("../desktop/lib/credential-store.cjs");
const { prepareBotGoConfig, restoreOriginalConfig } = require("../desktop/lib/codex-config.cjs");

assert.deepEqual(codexArgumentsFor("read-only"), ["exec", "--json", "--sandbox", "read-only"]);
assert.deepEqual(codexArgumentsFor("workspace-write"), ["exec", "--json", "--sandbox", "workspace-write"]);
assert.deepEqual(codexArgumentsFor("full-access"), ["exec", "--json", "--sandbox", "danger-full-access"]);
assert.throws(() => codexArgumentsFor("unknown"), /Unsupported permission/);

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "botgo-desktop-test-"));
const stateFile = path.join(temporaryDirectory, "state.json");
const state = createLocalStateStore({ filePath: stateFile });
state.save({ selectedProject: "C:\\work\\demo", recentProjects: ["C:\\work\\demo"], tasks: [{ id: "task-1", projectPath: "C:\\work\\demo", prompt: "inspect tests", status: "completed", changedFiles: ["README.md"] }] });
assert.deepEqual(state.load().recentProjects, ["C:\\work\\demo"]);
assert.equal(state.load().selectedProject, "C:\\work\\demo", "selected local project must survive restart");
assert.equal(state.load().version, 2, "legacy task history must migrate to the thread schema");
assert.equal(state.load().threads.length, 1, "legacy tasks must remain available as local conversations");
assert.equal(state.load().threads[0].messages[0].content, "inspect tests");
assert.throws(() => state.save({ deviceToken: "bgdt_private" }), /sensitive/i, "general desktop history must reject device credentials");
assert.doesNotMatch(fs.readFileSync(stateFile, "utf8"), /bgdt_|bgk_/);

const secureFile = path.join(temporaryDirectory, "credentials.bin");
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(Buffer.from(value, "utf8").toString("base64"), "utf8"),
  decryptString: (value) => Buffer.from(value.toString("utf8"), "base64").toString("utf8")
};
const credentials = createCredentialStore({ filePath: secureFile, safeStorage });
credentials.save({ deviceToken: "bgdt_private", desktopKey: "bgk_private" });
assert.deepEqual(credentials.load(), { deviceToken: "bgdt_private", desktopKey: "bgk_private" });
assert.doesNotMatch(fs.readFileSync(secureFile, "utf8"), /bgdt_private|bgk_private/);

const codexDirectory = path.join(temporaryDirectory, ".codex");
const configPath = path.join(codexDirectory, "config.toml");
fs.mkdirSync(codexDirectory);
fs.writeFileSync(configPath, "model_provider = \"existing\"\n", "utf8");
const backupDirectory = path.join(temporaryDirectory, "backups");
const prepared = prepareBotGoConfig({ configPath, backupDirectory, relayUrl: "https://api.botgo.test", confirmed: true });
assert.equal(fs.readFileSync(configPath, "utf8").includes('model_provider = "botgo"'), true);
assert.equal(fs.readFileSync(prepared.backupPath, "utf8"), "model_provider = \"existing\"\n");
restoreOriginalConfig({ configPath, backupPath: prepared.backupPath });
assert.equal(fs.readFileSync(configPath, "utf8"), "model_provider = \"existing\"\n");

const projectA = path.join(temporaryDirectory, 'a', 'same');
const projectB = path.join(temporaryDirectory, 'b', 'same');
fs.mkdirSync(projectA, { recursive: true }); fs.mkdirSync(projectB, { recursive: true });
fs.writeFileSync(path.join(projectA, 'keep.txt'), 'project source');
state.save({ selectedProject: projectA, selectedThreadId: 'a', recentProjects: [projectA, projectB], threads: [
  { id: 'a', title: 'A', projectPath: projectA, messages: [{ role: 'user', content: 'retained' }] },
  { id: 'b', title: 'B', projectPath: projectB },
  { id: 'c', title: 'C', projectPath: projectB, status: 'running' }
] });
assert.throws(() => state.renameThread('a', '  '));
assert.equal(state.renameThread('a', ' New title ').threads.find(t => t.id === 'a').title, 'New title');
assert.equal(state.load().threads.find(t => t.id === 'a').messages[0].content, 'retained');
assert.throws(() => state.deleteThread('c'), /停止/);
assert.throws(() => state.removeProject(projectB), /停止/);
assert.equal(state.recoverInterruptedThreads().threads.find(t => t.id === 'c').status, 'stopped');
const afterRemoval = state.removeProject(projectA);
assert.equal(fs.readFileSync(path.join(projectA, 'keep.txt'), 'utf8'), 'project source');
assert.equal(afterRemoval.selectedProject, projectB);
assert.equal(afterRemoval.threads.some(t => t.id === 'a'), false);
assert.equal(afterRemoval.recentProjects.length, 1);
state.save({ ...afterRemoval, threads: afterRemoval.threads.map(t => ({ ...t, status: 'completed' })) });
const beforeFailure = fs.readFileSync(stateFile, 'utf8');
const renameSync = fs.renameSync;
try { fs.renameSync = () => { throw new Error('disk unavailable'); }; assert.throws(() => state.deleteThread('b'), /disk unavailable/); }
finally { fs.renameSync = renameSync; }
assert.equal(fs.readFileSync(stateFile, 'utf8'), beforeFailure, 'failed atomic replacement preserves history');
assert.equal(fs.readdirSync(temporaryDirectory).some(name => name.endsWith('.tmp')), false);
const empty = state.removeProject(projectB);
assert.equal(empty.selectedProject, ''); assert.equal(empty.selectedThreadId, ''); assert.deepEqual(empty.threads, []);
fs.writeFileSync(stateFile, '{broken');
assert.throws(() => state.load(), /无法读取/);
assert.throws(() => state.removeProject(projectB), /无法读取/);
assert.equal(fs.readFileSync(stateFile, 'utf8'), '{broken');

fs.rmSync(temporaryDirectory, { recursive: true, force: true });
console.log("Desktop runtime boundary test passed");
