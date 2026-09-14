const runtimeRequests = new Map(), streamedMessages = new Map();
let streamRenderTimer;
function applyStreamMessages() {
  for (const { threadId, message } of streamedMessages.values()) {
    const thread = ui.history.threads.find(t => t.id === threadId); if (!thread) continue;
    const existing = thread.messages.find(m => m.id === message.id);
    if (existing) Object.assign(existing, message); else thread.messages.push({ ...message });
  }
}
function renderRuntimeRequests() {
  const node = $('[data-runtime-requests]'); node.hidden = !runtimeRequests.size; node.replaceChildren();
  for (const request of runtimeRequests.values()) {
    const article = document.createElement('article'), title = document.createElement('h3');
    title.textContent = request.kind === 'question' ? '需要你的回答' : '需要你的许可'; article.append(title);
    const reason = document.createElement('p'); reason.textContent = request.message; article.append(reason);
    if (request.details) { const details = document.createElement('details'), summary = document.createElement('summary'), text = document.createElement('pre'); summary.textContent = '查看操作详情'; text.textContent = request.details; details.append(summary, text); article.append(details); }
    const fields = [], formFields = [];
    if (request.kind === 'elicitation' && request.schema) for (const [name, rule] of Object.entries(request.schema.properties || {})) {
      const label = document.createElement('label'); label.textContent = rule.title || name;
      const choices = rule.enum || rule.oneOf?.map(o => o.const) || rule.items?.enum || rule.items?.anyOf?.map(o => o.const);
      const input = document.createElement(choices ? 'select' : 'input');
      if (choices) { input.multiple = rule.type === 'array'; for (const value of choices) { const option = document.createElement('option'); option.value = String(value); option.textContent = String(value); input.append(option); } }
      else input.type = rule.type === 'boolean' ? 'checkbox' : ['integer', 'number'].includes(rule.type) ? 'number' : 'text';
      input.required = (request.schema.required || []).includes(name); label.append(input); article.append(label); formFields.push({ name, rule, input });
    }
    if (request.url) { const notice = document.createElement('p'); notice.textContent = '第三方服务需要在浏览器中完成授权。'; article.append(notice); const open = document.createElement('button'); open.textContent = '打开授权页面'; open.onclick = () => window.botgo.openRequestUrl(request.threadId, request.requestId).catch(e => { error.textContent = e.message; }); article.append(open); }

    for (const question of request.questions) {
      const label = document.createElement('label'); label.textContent = question.question;
      const input = document.createElement('input'); input.type = question.isSecret ? 'password' : 'text'; input.maxLength = 10000;
      if (question.options?.length) {
        const select = document.createElement('select'); const empty = document.createElement('option'); empty.textContent = '选择或在下方填写'; empty.value = ''; select.append(empty);
        for (const option of question.options) { const el = document.createElement('option'); el.value = option.label; el.textContent = option.label + (option.description ? ' — ' + option.description : ''); select.append(el); }
        select.onchange = () => { input.value = select.value; }; label.append(select);
      }
      label.append(input); article.append(label); fields.push({ id: question.id, input });
    }
    const error = document.createElement('p'); error.setAttribute('role', 'alert');
    const answer = async decision => {
      const buttons = article.querySelectorAll('button'); buttons.forEach(b => b.disabled = true);
      try {
        const answers = Object.fromEntries(fields.map(f => [f.id, { answers: [f.input.value.trim()] }]));
        if (decision === 'accept' && fields.some(f => !f.input.value.trim())) throw Error('请填写所有问题。');
        await window.botgo.respondToRequest({ threadId: request.threadId, requestId: request.requestId, decision, answers, content: Object.fromEntries(formFields.filter(f => f.input.required || f.input.value || f.rule.type === 'boolean').map(({ name, rule, input }) => [name, rule.type === 'boolean' ? input.checked : rule.type === 'array' ? [...input.selectedOptions].map(o => o.value) : ['number', 'integer'].includes(rule.type) ? Number(input.value) : input.value])) });
        runtimeRequests.delete(request.requestId); renderRuntimeRequests();
      } catch (e) { error.textContent = e.message; buttons.forEach(b => b.disabled = false); }
    };
    if (request.kind === 'question' || request.kind === 'elicitation' || request.allow) { const accept = document.createElement('button'); accept.textContent = request.kind === 'question' ? '提交回答' : '允许这次操作'; accept.onclick = () => answer('accept'); article.append(accept); }
    if (request.kind !== 'question') { const decline = document.createElement('button'); decline.textContent = '拒绝'; decline.onclick = () => answer('decline'); article.append(decline); }
    if (request.kind === 'elicitation') { const cancel = document.createElement('button'); cancel.textContent = '取消授权'; cancel.onclick = () => answer('cancel'); article.append(cancel); }
    article.append(error); node.append(article);
  }
}
function handleRuntimeEvent(event) {
  if (event.threadId && ui.runningThread && event.threadId !== ui.runningThread) return;
  if (event.type === 'started') setMessage('BotGo 正在处理…');
  if (event.type === 'activity') setMessage(event.message);
  if (event.type === 'connection-closed') setMessage(event.message, true);
  if (event.type === 'runtime-notification' && event.message) setMessage(event.message);
  if (event.type === 'plan') {
    const thread = currentThread();
    if (thread) {
      const id = `plan:${event.turnId || 'current'}`;
      const content = [event.explanation || '计划已更新', ...(event.plan || []).map(item => `${item.status === 'completed' ? '✓' : item.status === 'inProgress' ? '→' : '○'} ${item.step}`)].filter(Boolean).join('\n');
      const existing = thread.messages.find(message => message.id === id);
      if (existing) Object.assign(existing, { kind: 'plan', content, plan: event.plan || [] });
      else thread.messages.push({ id, role: 'system', kind: 'plan', content, plan: event.plan || [], files: [], createdAt: new Date().toISOString() });
      renderConversation();
    }
  }
  if (event.type === 'diff' || event.type === 'review') {
    const thread = currentThread();
    if (thread) {
      thread.messages.push({ id: crypto.randomUUID(), role: 'system', kind: event.type,
        content: event.type === 'diff' ? `代码改动\n${event.diff || ''}` : `${event.operation || '审核'}\n${event.details || ''}`,
        files: [], createdAt: new Date().toISOString() });
      renderConversation();
    }
  }
  if (['delta', 'progress'].includes(event.type)) {
    const key = event.threadId + ':' + event.itemId;
    let entry = streamedMessages.get(key);
    if (!entry) { entry = { threadId: event.threadId, message: { id: event.itemId, role: 'assistant', content: '', model: modelSelect.value, files: [] } }; streamedMessages.set(key, entry); }
    entry.message.content = event.type === 'delta' ? entry.message.content + event.delta : event.message;
    if (!streamRenderTimer) streamRenderTimer = setTimeout(() => { streamRenderTimer = null; applyStreamMessages(); renderConversation(); }, 50);
  }
  if (event.type === 'request') { runtimeRequests.set(event.requestId, event); renderRuntimeRequests(); setMessage('等待你的回应'); }
  if (event.type === 'request-resolved') { runtimeRequests.delete(event.requestId); renderRuntimeRequests(); }
  if (event.type === 'requests-cleared') { runtimeRequests.clear(); renderRuntimeRequests(); }
  if (['completed', 'stopped', 'error'].includes(event.type)) {
    clearTimeout(streamRenderTimer); streamRenderTimer = null; streamedMessages.clear(); runtimeRequests.clear(); renderRuntimeRequests();
    ui.runningThread = ''; setRunning(false);
    setMessage(event.type === 'completed' ? '' : event.message || '已停止，历史已保留。', event.type === 'error');
    refreshHistory().catch(e => setMessage(e.message, true)); refreshAccount().catch(() => {});
  }
}
async function loadEarlierMessages() {
  const thread = currentThread(); if (!thread?.before) return;
  const page = await window.botgo.historyPage(thread.id, thread.before);
  if (currentThread()?.id !== thread.id) return;
  thread.messages.unshift(...page.messages); thread.before = page.before; renderConversation();
}
const updateRow = document.querySelector('[data-update-row]'), updateLabel = document.querySelector('[data-update-status]'), updateAction = document.querySelector('[data-update-action]');
let updateReady = false;
updateAction.onclick = async () => {
  updateAction.disabled = true;
  try { if (updateReady) await window.botgo.installUpdate(); else await window.botgo.checkUpdate(); }
  catch (error) { updateLabel.textContent = error.message; }
  finally { updateAction.disabled = false; }
};
window.botgo.onUpdate?.(status => {
  updateRow.hidden = !ui.account || !['checking', 'downloading', 'ready', 'error'].includes(status.state);
  updateRow.title = status.state === 'error' ? status.message || '更新失败' : status.version ? `版本 ${status.version}` : '';
  updateReady = status.state === 'ready';
  updateAction.textContent = updateReady ? '重启更新' : status.state === 'error' ? '重试更新' : '检查更新';
  updateAction.disabled = ['checking', 'downloading'].includes(status.state);
  updateLabel.textContent = ({ checking: '检查更新中', ready: '有新版本', error: '更新失败', downloading: `下载更新 ${status.total ? Math.floor(100 * status.received / status.total) : 0}%` })[status.state] || '';
});
let updateCheckedForAccount = false;
setInterval(() => {
  if (ui.account && !updateCheckedForAccount) { updateCheckedForAccount = true; window.botgo.checkUpdate?.().catch(() => {}); }
  if (!ui.account) updateCheckedForAccount = false;
}, 3000);
