const el = id => document.getElementById(id);
function render(state) {
  const ready = state.status === 'ready';
  document.body.dataset.mode = ready ? 'account' : 'login';
  el('status').textContent = state.message || ({ connecting: '正在连接…', waiting: '请在浏览器中完成登录' }[state.status] || '');
  el('details').hidden = !ready; el('account-actions').hidden = !ready; el('login').hidden = ready;
  el('login').disabled = ['connecting', 'waiting'].includes(state.status);
  el('email').textContent = state.email || '';
  el('balance').textContent = typeof state.balanceMicros === 'number' ? '¥' + (state.balanceMicros / 1e6).toFixed(4) : '—';
  el('update-status').textContent = state.updates?.message || '';
  el('install-update').hidden = state.updates?.status !== 'ready';
}
async function action(task) { try { const state = await task(); if (state) render(state); } catch { el('status').textContent = '操作未完成，请重试。'; } }
el('login').onclick = () => action(() => window.botgo.login());
el('refresh').onclick = async () => { el('refresh').disabled = true; el('refresh').textContent = '刷新中…'; await action(() => window.botgo.state(true)); el('refresh').disabled = false; el('refresh').textContent = '刷新'; };
el('logout').onclick = () => action(() => window.botgo.logout());
el('recharge').onclick = () => action(() => window.botgo.open('account'));
el('website').onclick = () => action(() => window.botgo.open('website'));
el('check-update').onclick = async () => {
  el('check-update').disabled = true;
  el('update-status').textContent = '正在检查更新…';
  try { const value = await window.botgo.checkUpdates(); el('update-status').textContent = value.message || '检查完成。'; el('install-update').hidden = !value.updateAvailable; }
  catch { el('update-status').textContent = '暂时无法检查更新，请稍后重试。'; }
  finally { el('check-update').disabled = false; }
};
el('install-update').onclick = () => action(() => window.botgo.installUpdate());
window.botgo.onChanged(render);
action(() => window.botgo.state());
