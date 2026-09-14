const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createAppServerRunner } = require('../../agent/lib/app-server.cjs');
const { nativeCommand, runtimeEnvironment } = require('../../agent/lib/native.cjs');
const { registerNativePanel } = require('../lib/native-panel.cjs');
const { createLocalStateStore } = require('../lib/local-state.cjs');
const { answer } = require('../../agent/test/fixtures/compat-mcp.cjs');
const out = path.resolve('artifacts/verification/native-compat/controlled-' + Date.now());
const projectPath = path.join(out, 'project'), codexHome = path.join(out, 'codex');
fs.mkdirSync(projectPath, { recursive: true }); fs.mkdirSync(codexHome, { recursive: true });
const command = nativeCommand(), runner = createAppServerRunner({ command, requestTimeout: 15000 });
const report = { time: new Date().toISOString(), kind: 'real pinned engine and controlled local services; no model requests', checks: [] };
const server = http.createServer(async (req, res) => {
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  let body = ''; for await (const chunk of req) body += chunk;
  const result = answer(JSON.parse(body));
  res.writeHead(result ? 200 : 202, { 'content-type': 'application/json' }); res.end(result ? JSON.stringify(result) : '');
});
let confirmResponse = 1;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const store = createLocalStateStore({ filePath: path.join(out, 'history.json') });
  store.save({ selectedProject: projectPath, recentProjects: [projectPath], threads: [] });
  const handlers = new Map();
  const options = { projectPath, codexHome, relayKey: 'bgk_controlled_fixture', relayOrigin: 'https://botgo.win', model: 'gpt-5.6-sol' };
  await runner.connect(options);
  registerNativePanel({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, dialog: { showMessageBox: async () => ({ response: confirmResponse }) },
    shell: {}, window: () => null, ensureRuntime: async () => runner, closeRuntime: () => runner.close(), state: () => store, paths: () => ({ codexHome }), busy: () => false, publicHistory: x => x });
  const invoke = (name, params) => handlers.get(name)(null, params);
  for (const spec of [
    { name: 'stdio_fixture', transport: 'stdio', command: process.execPath, args: [path.resolve('agent/test/fixtures/compat-mcp.cjs')] },
    { name: 'http_fixture', transport: 'http', url: `http://127.0.0.1:${server.address().port}/mcp` }
  ]) {
    await invoke('mcp:save', spec);
    report.checks.push({ name: `panel-save-${spec.transport}`, passed: true });
  }
  confirmResponse = 0;
  await assert.rejects(invoke('mcp:save', { name: 'cancelled', transport: 'stdio', command: process.execPath, args: [] }), /取消/);
  assert.ok(!fs.readFileSync(path.join(codexHome, 'config.toml'), 'utf8').includes('cancelled'));
  report.checks.push({ name: 'cancel-before-mcp-start', passed: true }); confirmResponse = 1;
  const thread = (await runner.request('thread/start', { cwd: projectPath, sandbox: 'workspace-write', modelProvider: 'botgo', model: 'gpt-5.6-sol' })).thread;
  const status = await runner.request('mcpServerStatus/list', { threadId: thread.id, limit: 100 });
  for (const name of ['stdio_fixture', 'http_fixture']) {
    assert.ok(status.data.find(s => s.name === name)?.tools.compat_echo, `${name} tool discovery`);
    const result = await runner.request('mcpServer/tool/call', { threadId: thread.id, server: name, tool: 'compat_echo', arguments: { text: 'direct-test' } });
    assert.match(JSON.stringify(result), /BOTGO_MCP_OK/); report.checks.push({ name: `native-tool-${name}`, passed: true });
    const failure = await runner.request('mcpServer/tool/call', { threadId: thread.id, server: name, tool: 'compat_echo', arguments: { text: 'controlled-failure' } });
    assert.match(JSON.stringify(failure), /"isError":true/); report.checks.push({ name: `native-tool-error-${name}`, passed: true });
  }
  const list = await invoke('extensions:list'); assert.equal(list.mcp.length, 2);
  await invoke('mcp:toggle', { name: 'stdio_fixture', enabled: false });
  await invoke('mcp:toggle', { name: 'stdio_fixture', enabled: true });
  report.checks.push({ name: 'native-mcp-enable-disable', passed: true });
  runner.close();
  const marketplace = path.join(out, 'marketplace');
  const pluginRoot = path.join(marketplace, 'plugins/botgo-compat-fixture');
  fs.mkdirSync(path.join(marketplace, '.agents/plugins'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, '.codex-plugin'), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, 'skills/compat-skill'), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'botgo-compat-fixture', version: '0.1.0', description: 'Controlled test plugin', skills: './skills/' }));
  fs.writeFileSync(path.join(pluginRoot, 'skills/compat-skill/SKILL.md'), '---\nname: compat-skill\ndescription: Controlled verification skill\n---\nWhen explicitly invoked, respond with BOTGO_SKILL_OK.\n');
  fs.writeFileSync(path.join(marketplace, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'personal', plugins: [{ name: 'botgo-compat-fixture', source: { source: 'local', path: './plugins/botgo-compat-fixture' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] }));
  execFileSync(command, ['plugin', 'marketplace', 'add', marketplace], { env: runtimeEnvironment(codexHome, 'bgk_controlled_fixture'), cwd: projectPath, windowsHide: true, stdio: 'pipe', timeout: 15000 });
  await runner.connect(options);
  const catalog = await invoke('extensions:list');
  const plugin = catalog.plugins.find(p => p.name === 'botgo-compat-fixture'); assert.ok(plugin, 'local plugin discovered');
  await invoke('plugins:install', plugin.id); report.checks.push({ name: 'native-plugin-install-through-panel', passed: true });
  await invoke('extensions:list');
  await invoke('plugins:toggle', { id: plugin.id, enabled: false });
  await invoke('plugins:toggle', { id: plugin.id, enabled: true });
  report.checks.push({ name: 'native-plugin-enable-disable', passed: true });
  const installed = await invoke('extensions:list');
  report.skillNames = installed.skills.map(s => s.name);
  const skill = installed.skills.find(s => s.name.endsWith('compat-skill')); assert.ok(skill, 'installed plugin skill discovery');
  assert.match((await invoke('skills:read', skill.id)).text, /BOTGO_SKILL_OK/);
  await invoke('skills:toggle', { id: skill.id, enabled: false });
  await invoke('skills:toggle', { id: skill.id, enabled: true });
  report.checks.push({ name: 'native-skill-discover-read-enable-disable', passed: true });
  report.status = 'passed';
})().catch(error => { report.status = 'failed'; report.error = error.message; process.exitCode = 1; }).finally(() => {
  runner.close(); server.closeAllConnections(); server.close(); fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
});
