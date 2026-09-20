(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const dialog = $('#account-dialog');
  if (!dialog) return;
  const params = new URLSearchParams(location.search);
  const preview = ['localhost', '127.0.0.1', '::1'].includes(location.hostname) && params.get('preview') === 'account';
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('botgo-web-auth') : null;
  const loginForm = $('#login-form'), verifyForm = $('#verify-form');
  let account = null, epoch = 0, loggedOut = false, logoutPending = false, nextDownload = params.get('next') === 'download';
  const money = cents => `￥${(Number(cents) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  function show(section) {
    $('#account-auth').hidden = section !== 'auth';
    $('#account-signed-in').hidden = section !== 'account';
    $('#account-recharge').hidden = section !== 'recharge';
    $('#account-title').textContent = section === 'recharge' || account ? '账户 / 充值' : '登录 / 注册';
  }
  function open(panel = 'account', options = {}) {
    if (options.next === 'download') nextDownload = true;
    const section = account ? (panel === 'recharge' ? 'recharge' : 'account') : 'auth';
    if (section === 'auth') { loginForm.hidden = false; verifyForm.hidden = true; }
    show(section);
    if (!dialog.open) dialog.showModal();
    if (section === 'auth') loginForm.elements.email.focus();
  }
  window.botgoAccount = { open };
  function render() {
    const signedIn = !!account;
    $('#account-trigger').textContent = signedIn ? '账户 / 充值' : '登录 / 注册';
    $('[data-billing-balance]').textContent = signedIn ? money(account.balanceCents ?? Math.round(Number(account.credits || 0) * 100)) : '—';
    $('[data-account-email]').textContent = signedIn ? account.email : '—';
    if (dialog.open) show(signedIn ? 'account' : 'auth');
  }
  function status(id, message, error = false) {
    const node = $('#' + id);
    node.textContent = message;
    node.className = `form-status ${error ? 'is-error' : 'is-success'}`;
  }
  async function api(path, options = {}) {
    const requestEpoch = epoch;
    const response = await fetch('/api' + path, { credentials: 'same-origin', ...options });
    const body = await response.json().catch(() => ({}));
    if (requestEpoch !== epoch) throw new DOMException('Account changed', 'AbortError');
    if (!response.ok) {
      const error = new Error(body.error || '请求未完成，请稍后重试。');
      error.status = response.status;
      if (response.status === 401 && account) clearSession();
      throw error;
    }
    return body;
  }
  function clearSession() {
    epoch++; loggedOut = true; account = null;
    loginForm.reset(); verifyForm.reset(); render();
    window.dispatchEvent(new Event('botgo:logout'));
  }
  async function refreshAccount() {
    if (preview || loggedOut) return;
    const requestEpoch = epoch;
    try {
      const order = params.get('out_trade_no');
      if (order) await api('/billing/query', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ outTradeNo: order }) });
      const result = await api('/account');
      if (requestEpoch === epoch) { account = result.account; render(); }
    } catch (error) {
      if (requestEpoch === epoch) { if (error.status === 401) account = null; render(); }
    }
  }
  async function logout() {
    if (logoutPending) return;
    logoutPending = true;
    const button = $('#logout-button'); button.disabled = true;
    try {
      if (!preview) {
        const response = await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.timeout(20000) });
        if (!response.ok) throw new Error('退出未完成，请重试。');
      }
      clearSession(); channel?.postMessage('logout');
      try { localStorage.setItem('botgo-web-logout', crypto.randomUUID()); } catch {}
    } catch (error) { status('account-status', error.message, true); }
    finally { logoutPending = false; button.disabled = false; }
  }
  document.querySelectorAll('[data-open-account]').forEach(button => button.addEventListener('click', () => open()));
  $('#account-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  $('#open-recharge').addEventListener('click', () => show('recharge'));
  $('#recharge-back').addEventListener('click', () => show('account'));
  $('#auth-back').addEventListener('click', () => { verifyForm.hidden = true; loginForm.hidden = false; loginForm.elements.email.focus(); });
  $('#logout-button').addEventListener('click', logout);
  channel?.addEventListener('message', event => { if (event.data === 'logout') clearSession(); });
  window.addEventListener('storage', event => { if (event.key === 'botgo-web-logout' && event.newValue) clearSession(); });
  window.addEventListener('botgo:account-refresh', refreshAccount);
  loginForm.addEventListener('submit', async event => {
    event.preventDefault(); const button = loginForm.querySelector('[type=submit]');
    if (button.disabled) return; button.disabled = true;
    const email = new FormData(loginForm).get('email');
    try {
      await api('/auth/request-login-code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
      loginForm.hidden = true; verifyForm.hidden = false;
      verifyForm.elements.email.value = email;
      status('verify-status', '验证码已发送，请检查邮箱。'); verifyForm.elements.code.focus();
    } catch (error) { status('login-status', error.message, true); }
    finally { button.disabled = false; }
  });
  verifyForm.addEventListener('submit', async event => {
    event.preventDefault(); const button = verifyForm.querySelector('[type=submit]');
    if (button.disabled) return; button.disabled = true;
    const data = Object.fromEntries(new FormData(verifyForm));
    data.code = String(data.code || '').trim().replace(/[０-９]/g, digit => String(digit.charCodeAt(0) - 0xfee0));
    try {
      const result = await api('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
      epoch++; loggedOut = false; account = result.account; render();
      window.dispatchEvent(new Event('botgo:account-refresh'));
      if (nextDownload) { nextDownload = false; dialog.close(); window.botgoDownload?.(); }
      else if (params.get('panel') === 'recharge') show('recharge');
    } catch (error) { status('verify-status', error.message, true); }
    finally { button.disabled = false; }
  });
  if (preview) { account = { email: 'preview@botgo.local', balanceCents: 102000 }; render(); }
  else refreshAccount().then(() => {
    if (account && nextDownload) { nextDownload = false; window.botgoDownload?.(); }
    if (params.has('out_trade_no')) history.replaceState(null, '', location.pathname + '?panel=recharge');
    if (params.get('panel') || params.has('out_trade_no') || params.get('auth')) open(params.get('panel') || 'account');
  });
  if (preview && params.get('panel')) open(params.get('panel'));
})();
