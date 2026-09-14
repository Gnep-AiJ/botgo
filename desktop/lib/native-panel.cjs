const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

// Explicit operations and catalog-issued handles; no renderer-controlled RPC/config path.
function registerNativePanel({ ipcMain, dialog, shell, window, ensureRuntime, closeRuntime, state, paths, busy, publicHistory }) {
  const skills = new Map(), plugins = new Map(), servers = new Set();
  let changing = false, oauthPending = false;
  const idle = () => { if (busy()) throw Error('请先停止当前任务再更改扩展。'); };
  const project = () => state().load().selectedProject;
  const call = async (method, params) => (await ensureRuntime()).request(method, params);
  const confirm = async (message, detail) => {
    const result = await dialog.showMessageBox(window(), { type: 'question', message, detail,
      buttons: ['取消', '确认'], defaultId: 0, cancelId: 0 });
    if (result.response !== 1) throw Error('操作已取消。');
    idle();
  };
  const write = (keyPath, value) => call('config/value/write', { keyPath, value, mergeStrategy: 'replace', filePath: path.join(paths().codexHome, 'config.toml') });
  const handle = (name, fn) => ipcMain.handle(name, async (_event, payload) => {
    const mutation = !['extensions:list', 'skills:read', 'plugins:read'].includes(name);
    if (mutation) { idle(); if (changing) throw Error('已有扩展操作正在处理。'); changing = true; }
    try { return await fn(payload); } finally { if (mutation) changing = false; }
  });
  handle('extensions:list', async () => {
    const outcomes = await Promise.allSettled([
      call('mcpServerStatus/list', { limit: 100 }),
      call('skills/list', { cwds: [project()], forceReload: true }),
      call('plugin/list', { cwds: [project()], marketplaceKinds: ['local'], forceRefetch: false })
    ]);
    const errors = outcomes.map((r, i) => r.status === 'rejected' ? `${['MCP', 'Skills', '插件'][i]}：${r.reason.message}` : '').filter(Boolean);
    const mcp = outcomes[0].value?.data || [];
    servers.clear(); mcp.forEach(s => servers.add(s.name));
    const foundSkills = (outcomes[1].value?.data || []).flatMap(entry => entry.skills);
    skills.clear(); foundSkills.forEach(s => skills.set(s.path, s));
    plugins.clear();
    for (const market of outcomes[2].value?.marketplaces || []) for (const p of market.plugins) {
      if (!market.path) continue; // Official account-only catalogs are outside this release.
      plugins.set(p.id, { ...p, marketplacePath: market.path });
    }
    return { errors, mcp: mcp.map(s => ({ name: s.name, authStatus: s.authStatus, status: s.runtimeStatus,
      error: s.toolsError, tools: Object.entries(s.tools).map(([name, t]) => ({ name, description: t.description || '' })) })),
      skills: foundSkills.map(s => ({ id: s.path, name: s.name, description: s.description, enabled: s.enabled })),
      plugins: [...plugins.values()].map(p => ({ id: p.id, name: p.name, enabled: p.enabled, installed: p.installed, availability: p.availability })) };
  });
  handle('mcp:save', async spec => {
    idle();
    if (!spec || !/^[a-zA-Z0-9_-]{1,64}$/.test(spec.name)) throw Error('MCP 名称仅允许字母、数字、下划线和连字符。');
    let value;
    if (spec.transport === 'stdio') {
      if (typeof spec.command !== 'string' || !spec.command.trim() || !Array.isArray(spec.args) || spec.args.some(a => typeof a !== 'string')) throw Error('请输入命令和参数列表。');
      value = { command: spec.command.trim(), args: spec.args, enabled: spec.enabled !== false };
    } else if (spec.transport === 'http') {
      const url = new URL(spec.url);
      if (url.username || url.password || !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw Error('远程 MCP 需要 HTTPS；本地服务可使用回环 HTTP。');
      value = { url: url.toString(), enabled: spec.enabled !== false };
    } else throw Error('请选择 MCP 连接方式。');
    await confirm('保存并连接 MCP？', `${spec.name}\n${value.command || value.url}\n本地命令需要对应程序已安装；MCP 可执行工具和访问外部服务。`);
    const existing = (await call('config/read', {})).config?.mcp_servers?.[spec.name] || {};
    const merged = { ...existing, ...value };
    if (spec.transport === 'stdio') { delete merged.url; }
    else { delete merged.command; delete merged.args; }
    await write(`mcp_servers.${spec.name}`, merged);
    await call('config/mcpServer/reload', null); return { ok: true };
  });
  handle('mcp:toggle', async ({ name, enabled }) => {
    idle(); if (!servers.has(name) || typeof enabled !== 'boolean') throw Error('请先刷新 MCP 列表。');
    if (enabled) await confirm('启用 MCP？', name);
    await write(`mcp_servers.${JSON.stringify(name)}.enabled`, enabled);
    await call('config/mcpServer/reload', null); return { ok: true };
  });
  handle('mcp:reconnect', async () => { idle(); await call('config/mcpServer/reload', null); return { ok: true }; });
  handle('mcp:login', async name => {
    idle(); if (!servers.has(name)) throw Error('请先刷新 MCP 列表。');
    const result = await call('mcpServer/oauth/login', { name, timeoutSecs: 120 });
    const url = new URL(result.authorizationUrl);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('授权地址无效。');
    oauthPending = true; await shell.openExternal(url.toString()); return { pending: true };
  });
  handle('mcp:cancel-login', () => { if (oauthPending) closeRuntime(); oauthPending = false; return { ok: true }; });
  handle('configuration:import', async () => {
    idle(); const result = await dialog.showOpenDialog(window(), { properties: ['openFile'], filters: [{ name: 'Codex 配置', extensions: ['toml'] }] });
    if (result.canceled) return { cancelled: true };
    const source = result.filePaths[0];
    if (fs.statSync(source).size > 1024 * 1024) throw Error('配置超过 1 MB。');
    await confirm('导入配置到 BotGo？', `${source}\n将备份并替换 BotGo 独立配置。配置中的 MCP 和插件可能在下次连接时运行；账户路由继续由 BotGo 管理。`);
    const target = path.join(paths().codexHome, 'config.toml');
    if (path.resolve(source) === path.resolve(target)) throw Error('已是 BotGo 当前配置。');
    closeRuntime(); fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) fs.copyFileSync(target, target + '.before-import-' + Date.now());
    fs.copyFileSync(source, target); return { ok: true };
  });
  handle('skills:read', id => {
    const skill = skills.get(id); if (!skill) throw Error('请先刷新技能列表。');
    if (fs.statSync(skill.path).size > 1024 * 1024) throw Error('技能文件超过 1 MB。');
    return { text: fs.readFileSync(skill.path, 'utf8') };
  });
  handle('skills:toggle', async ({ id, enabled }) => {
    idle(); if (!skills.has(id) || typeof enabled !== 'boolean') throw Error('技能选择无效。');
    await call('skills/config/write', { path: id, enabled }); return { ok: true };
  });
  handle('skills:install', async () => {
    idle(); const result = await dialog.showOpenDialog(window(), { properties: ['openFile'], filters: [{ name: 'Skill', extensions: ['md'] }] });
    if (result.canceled) return { cancelled: true };
    const file = result.filePaths[0]; if (path.basename(file).toUpperCase() !== 'SKILL.MD') throw Error('请选择 SKILL.md。');
    const source = path.dirname(file), name = path.basename(source);
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(name)) throw Error('技能目录名仅允许字母、数字、下划线和连字符。');
    await confirm('安装本地技能？', `${source}\n技能可能包含脚本；请确认来源。`);
    const target = path.join(paths().codexHome, 'skills', name);
    if (fs.existsSync(target)) throw Error('同名技能已存在，未覆盖。');
    let bytes = 0, count = 0;
    function inspect(dir) { for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const sourceFile = path.join(dir, item.name);
      if (item.isSymbolicLink()) throw Error('技能包含链接，未安装。');
      if (item.isDirectory()) inspect(sourceFile);
      else { bytes += fs.statSync(sourceFile).size; if (++count > 2000 || bytes > 20 * 1024 * 1024) throw Error('技能超过 20 MB 或 2000 个文件。'); }
    } }
    inspect(source); fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false }); return { ok: true };
  });
  handle('plugins:read', async id => {
    const p = plugins.get(id); if (!p) throw Error('请刷新插件列表。');
    const result = await call('plugin/read', { pluginName: p.name, marketplacePath: p.marketplacePath });
    return { name: p.name, description: result.plugin?.description || '', skills: result.plugin?.skills || [] };
  });
  handle('plugins:add-marketplace', async () => {
    const result = await dialog.showOpenDialog(window(), { properties: ['openDirectory'] });
    if (result.canceled) return { cancelled: true };
    const directory = result.filePaths[0];
    await confirm('添加本地插件目录？', `${directory}\n目录必须包含原生支持的 marketplace 清单。添加目录后仍需单独确认安装插件。`);
    await ensureRuntime(); closeRuntime();
    const { nativeCommand, agentRoot } = require('./agent-runtime.cjs');
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^(CODEX_HOME|BOTGO_CODEX_API_KEY|OPENAI_API_KEY|CODEX_API_KEY|OPENAI_BASE_URL|OPENAI_ORG_ID)$/i.test(key)) delete env[key];
    env.CODEX_HOME = paths().codexHome;
    try { await promisify(execFile)(nativeCommand(agentRoot), ['plugin', 'marketplace', 'add', directory], { cwd: directory, env, windowsHide: true, timeout: 20000 }); }
    catch { throw Error('原生引擎未能添加此目录。请确认其中包含受支持的 marketplace 清单。'); }
    return { ok: true };
  });
  handle('plugins:install', async id => {
    idle(); const p = plugins.get(id); if (!p) throw Error('请刷新插件列表。');
    await confirm('安装外部插件？', `${p.name}\n来源：${p.marketplacePath}\n插件可能包含技能、脚本和 MCP 服务。`);
    await call('plugin/install', { pluginName: p.name, marketplacePath: p.marketplacePath }); return { ok: true };
  });
  handle('plugins:toggle', async ({ id, enabled }) => {
    idle(); if (!plugins.has(id) || typeof enabled !== 'boolean') throw Error('插件选择无效。');
    if (enabled) await confirm('启用插件？', plugins.get(id).name);
    await write(`plugins.${JSON.stringify(id)}.enabled`, enabled); await call('config/mcpServer/reload', null); return { ok: true };
  });
  handle('thread:fork', async id => {
    idle(); const history = state().load(), source = history.threads.find(t => t.id === id);
    if (!source?.sessionId) throw Error('对话尚无原生会话，无法分叉。');
    const result = await call('thread/fork', { threadId: source.sessionId, cwd: source.projectPath, modelProvider: 'botgo', sandbox: 'workspace-write', approvalPolicy: 'on-request', approvalsReviewer: 'auto_review' });
    const thread = { ...source, id: crypto.randomUUID(), sessionId: result.thread.id, title: `${source.title} · 分叉`, status: 'idle', archived: false, updatedAt: new Date().toISOString() };
    state().save({ ...history, selectedThreadId: thread.id, threads: [thread, ...history.threads] }); return publicHistory(state().load());
  });
  handle('thread:archive', async ({ id, archived }) => {
    idle(); const history = state().load(), thread = history.threads.find(t => t.id === id);
    if (!thread || typeof archived !== 'boolean') throw Error('对话选择无效。');
    if (thread.sessionId) await call(archived ? 'thread/archive' : 'thread/unarchive', { threadId: thread.sessionId });
    thread.archived = archived; state().save(history); return publicHistory(state().load());
  });
  return { get busy() { return changing; }, skillInput(ids = []) {
    if (!Array.isArray(ids) || ids.length > 16) throw Error('???????');
    return ids.map(id => { const skill = skills.get(id); if (!skill?.enabled) throw Error('????????????'); return { type: 'skill', name: skill.name, path: skill.path }; });
  } };
}
module.exports = { registerNativePanel };
