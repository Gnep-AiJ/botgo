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
    const fields = [];
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
        if (fields.some(f => !f.input.value.trim())) throw Error('请填写所有问题。');
        await window.botgo.respondToRequest({ threadId: request.threadId, requestId: request.requestId, decision, answers });
        runtimeRequests.delete(request.requestId); renderRuntimeRequests();
      } catch (e) { error.textContent = e.message; buttons.forEach(b => b.disabled = false); }
    };
    if (request.kind === 'question' || request.allow) { const accept = document.createElement('button'); accept.textContent = request.kind === 'question' ? '提交回答' : '允许这次操作'; accept.onclick = () => answer('accept'); article.append(accept); }
    if (request.kind !== 'question') { const decline = document.createElement('button'); decline.textContent = '拒绝'; decline.onclick = () => answer('decline'); article.append(decline); }
    article.append(error); node.append(article);
  }
}
function handleRuntimeEvent(event) {
  if (event.threadId && ui.runningThread && event.threadId !== ui.runningThread) return;
  if (event.type === 'started') setMessage('BotGo 正在处理…');
  if (event.type === 'activity') setMessage(event.message);
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
const updateNotice = document.createElement('div'), updateLabel = document.createElement('span'), updateAction = document.createElement('button');
updateNotice.className = 'update-notice'; updateAction.type = 'button'; updateAction.textContent = '检查更新';
updateNotice.append(updateLabel, updateAction); document.querySelector('.sidebar-account').prepend(updateNotice);
let updateReady = false;
updateAction.onclick = async () => {
  updateAction.disabled = true;
  try { if (updateReady) await window.botgo.installUpdate(); else await window.botgo.checkUpdate(); }
  catch (error) { updateLabel.textContent = error.message; }
  finally { updateAction.disabled = false; }
};
window.botgo.onUpdate?.(status => {
  updateReady = status.state === 'ready';
  updateAction.textContent = updateReady ? '重启更新' : status.state === 'error' ? '重试更新' : '检查更新';
  updateAction.disabled = ['checking', 'downloading'].includes(status.state);
  updateLabel.textContent = ({ checking: '正在检查更新', current: '已是最新版本', ready: `新版 ${status.version} 已就绪，任务结束后可安装`, error: status.message, downloading: `正在下载 ${status.version}：${Math.floor(100 * status.received / status.total)}%` })[status.state] || '';
});
let updateCheckedForAccount = false;
setInterval(() => {
  if (ui.account && !updateCheckedForAccount) { updateCheckedForAccount = true; window.botgo.checkUpdate?.().catch(() => {}); }
  if (!ui.account) updateCheckedForAccount = false;
}, 3000);
