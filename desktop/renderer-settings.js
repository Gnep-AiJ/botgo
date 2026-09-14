let pendingAttachments = [], pendingSkills = [], planRequested = false, reviewRequested = false;
function renderAttachments() {
  const node = $('[data-attachments]'); node.replaceChildren();
  for (const [list, label] of [[pendingAttachments, '附件'], [pendingSkills, '技能']]) for (const item of list) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `${label}：${item.name} ×`;
    button.setAttribute('aria-label', `移除${label} ${item.name}`);
    button.onclick = () => { list.splice(list.indexOf(item), 1); renderAttachments(); }; node.append(button);
  }
}
async function panelAction(action, history = false) {
  const status = $('[data-settings-status]'); status.textContent = '正在处理…';
  try { const result = await action(); status.textContent = result?.pending ? '请在浏览器完成授权；取消可关闭浏览器，授权将在两分钟后超时。' : '已完成'; if (history) { closeMenus(); await refreshHistory(); } return result; }
  catch (error) { status.textContent = error.message; setMessage(error.message, true); return null; }
}
function panelButton(label, action) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label;
  button.onclick = async () => { button.disabled = true; try { await action(); } finally { button.disabled = false; } }; return button;
}
function panelRow(node, name, description) {
  const article = document.createElement('article'), title = document.createElement('h4'), text = document.createElement('p');
  title.textContent = name; text.textContent = description || ''; article.append(title, text); node.append(article); return article;
}
async function refreshExtensions() {
  const result = await panelAction(() => window.botgo.extensions()); if (!result) return;
  $('[data-settings-status]').textContent = result.errors.join('\n') || '扩展列表已刷新';
  for (const key of ['mcp', 'skills', 'plugins']) $(`[data-${key}-list]`).replaceChildren();
  for (const server of result.mcp) {
    const connection = ({ notStarted: '未启动', starting: '连接中', connected: '已连接', ready: '已连接', authenticationRequired: '需要登录', failed: '连接失败', cancelled: '已取消', disabled: '已停用' })[server.status] || '状态未提供';
    const auth = ({ unknown: '授权状态未知', unsupported: '无需 OAuth', notLoggedIn: '尚未登录', bearerToken: '已配置授权', oAuth: '已登录' })[server.authStatus] || '授权状态未知';
    const row = panelRow($('[data-mcp-list]'), server.name, `${connection} · ${auth}${server.error ? ' · ' + server.error : ''}`);
    row.append(panelButton('OAuth 登录', () => panelAction(() => window.botgo.loginMcp(server.name))),
      panelButton('启用', async () => { await panelAction(() => window.botgo.toggleMcp(server.name, true)); await refreshExtensions(); }),
      panelButton('停用', async () => { await panelAction(() => window.botgo.toggleMcp(server.name, false)); await refreshExtensions(); }),
      panelButton('编辑', () => { const form = $('[data-mcp-form]'); form.closest('details').open = true; form.elements.name.value = server.name; form.elements.command.focus(); }));
    const tools = document.createElement('details'), summary = document.createElement('summary'); summary.textContent = `${server.tools.length} 个工具`; tools.append(summary);
    for (const tool of server.tools) { const p = document.createElement('p'); p.textContent = `${tool.name}：${tool.description}`; tools.append(p); } row.append(tools);
  }
  for (const skill of result.skills) {
    const row = panelRow($('[data-skills-list]'), skill.name, skill.description);
    row.append(panelButton('查看', async () => { const r = await panelAction(() => window.botgo.readSkill(skill.id)); if (r) showExtensionDetail(r.text); }),
      panelButton(skill.enabled ? '停用' : '启用', async () => { await panelAction(() => window.botgo.toggleSkill(skill.id, !skill.enabled)); await refreshExtensions(); }));
    if (skill.enabled) row.append(panelButton('用于下一条任务', () => { if (!pendingSkills.some(s => s.id === skill.id)) pendingSkills.push(skill); renderAttachments(); $('[data-settings-dialog]').close(); $('[data-task-prompt]').focus(); }));
  }
  for (const plugin of result.plugins) {
    const row = panelRow($('[data-plugins-list]'), plugin.name, plugin.installed ? '已安装' : plugin.availability || '可安装');
    row.append(panelButton('查看', async () => { const r = await panelAction(() => window.botgo.readPlugin(plugin.id)); if (r) showExtensionDetail(JSON.stringify(r, null, 2)); }));
    if (!plugin.installed && (!plugin.availability || plugin.availability === 'AVAILABLE')) row.append(panelButton('安装', async () => { await panelAction(() => window.botgo.installPlugin(plugin.id)); await refreshExtensions(); }));
    if (plugin.installed) row.append(panelButton(plugin.enabled ? '停用' : '启用', async () => { await panelAction(() => window.botgo.togglePlugin(plugin.id, !plugin.enabled)); await refreshExtensions(); }));
  }
  for (const key of ['mcp', 'skills', 'plugins']) if (!$(`[data-${key}-list]`).children.length) $(`[data-${key}-list]`).textContent = '没有可显示的项目';
}
function showExtensionDetail(text) { const node = $('[data-extension-detail]'); node.hidden = false; node.textContent = text; }
$('[data-settings]').onclick = () => {
  $('[data-settings-dialog]').showModal(); const node = $('[data-archived-list]'); node.replaceChildren();
  for (const thread of ui.history.threads.filter(t => t.archived)) node.append(panelButton(`恢复 ${thread.title}`, async () => { await panelAction(() => window.botgo.archiveThread(thread.id, false), true); $('[data-settings-dialog]').close(); }));
  if (!node.children.length) node.textContent = '没有已归档会话';
  $('[data-settings-close]').focus();
  refreshExtensions();
};
$('[data-settings-close]').onclick = () => { $('[data-settings-dialog]').close(); $('[data-settings]').focus(); };
$('[data-settings-dialog]').addEventListener('cancel', () => queueMicrotask(() => $('[data-settings]').focus()));
$('[data-extensions-refresh]').onclick = refreshExtensions;
$('[data-mcp-reconnect]').onclick = async () => { await panelAction(() => window.botgo.reconnectMcp()); await refreshExtensions(); };
$('[data-mcp-cancel-login]').onclick = () => panelAction(() => window.botgo.cancelMcpLogin());
$('[data-import-configuration]').onclick = () => panelAction(() => window.botgo.importConfiguration());
$('[data-skill-install]').onclick = async () => { await panelAction(() => window.botgo.installSkill()); await refreshExtensions(); };
$('[data-plugin-marketplace]').onclick = async () => { await panelAction(() => window.botgo.addPluginMarketplace()); await refreshExtensions(); };
$('[data-mcp-form]').onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget, spec = Object.fromEntries(new FormData(form)); spec.args = spec.args.split('\n').filter(Boolean);
  const button = form.querySelector('button'); button.disabled = true;
  try { await panelAction(() => window.botgo.saveMcp(spec)); await refreshExtensions(); } finally { button.disabled = false; }
};
$('[data-attach]').onclick = async () => { try { const files = await window.botgo.chooseAttachments(); if (pendingAttachments.length + files.length > 16) throw Error('最多添加 16 个附件。'); pendingAttachments.push(...files); renderAttachments(); } catch (error) { setMessage(error.message, true); } };
$('[data-plan]').onclick = event => { planRequested = !planRequested; event.currentTarget.setAttribute('aria-pressed', String(planRequested)); };
$('[data-review-code]').onclick = () => {
  if (ui.runningThread) return $('[data-settings-status]').textContent = '请先结束当前任务。';
  reviewRequested = true; $('[data-task-prompt]').value = '审阅当前项目的未提交改动'; $('[data-settings-dialog]').close(); syncControls(); $('[data-task-prompt]').focus();
};
