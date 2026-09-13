// Real Chromium windows with isolated API fixtures; never production login evidence.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'artifacts/verification/logout-ui');
fs.mkdirSync(out, { recursive: true }); app.setPath('userData', path.join(out, 'profile')); app.disableHardwareAcceleration();
let signed = true, failLogout = false, logoutCount = 0, accountGate = null, checkoutGate = null, stream = null;
const errors = [], windows = [], checks = [];
const account = { id: 'fixture', email: 'long.fixture.account.for.layout@example.invalid', balanceCents: 102000 };
const server = http.createServer(async (req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  const send = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (!route.startsWith('/api/')) {
    const file = path.resolve(root, 'dist', '.' + (route === '/' ? '/workspace.html' : route));
    if (!file.startsWith(path.join(root, 'dist') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp' })[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file)); return;
  }
  if (route === '/api/models') return send({ defaultModel: 'gpt-5.6-sol', models: [{ id: 'gpt-5.6-sol', name: 'Sol', enabled: true, web: true }] });
  if (route === '/api/account') {
    const snapshot = signed;
    if (accountGate) { const gate = accountGate; accountGate = null; await gate; }
    return send(snapshot ? { account } : { error: '登录已失效' }, snapshot ? 200 : 401);
  }
  if (route === '/api/auth/logout') { logoutCount++; if (failLogout) return send({ error: 'retry' }, 503); signed = false; return send({ ok: true }); }
  if (route === '/api/auth/login') { signed = true; return send({ account }); }
  if (route === '/api/billing/plan') return send({ paymentAvailable: true, recharge: { minAmountCents: 1000, maxAmountCents: 999900 } });
  if (route === '/api/billing/checkout') { if (checkoutGate) await checkoutGate; return send({ paymentUrl: 'https://example.invalid/payment', order: { outTradeNo: 'fixture' } }); }
  if (route === '/api/conversations' && req.method === 'POST') return send({ id: 'conversation-fixture' });
  if (route === '/api/conversations') return send({ conversations: signed ? [{ id: 'saved', title: '保留的云端历史' }] : [], hasMore: false });
  if (route === '/api/chat/stream') { stream = res; res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write('data: {"choices":[{"delta":{"content":"fixture partial"}}]}\n\n'); return; }
  if (route === '/api/desktop/releases/current') return send({ release: { version: '1.0.0-fixture', downloadUrl: '/api/desktop/releases/fixture/download' } });
  return send({});
});
const pause = ms => new Promise(r => setTimeout(r, ms));
const run = (w, js) => w.webContents.executeJavaScript(js, true);
async function until(w, js) { for (let i = 0; i < 100; i++) { if (await run(w, js)) return; await pause(50); } throw Error('Timed out: ' + js); }
async function click(w, selector) {
  w.focus(); w.webContents.focus(); await pause(80);
  const point = await run(w, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})()`);
  if (!point.hit) throw Error(selector + ' ' + JSON.stringify(await run(w, `(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {hidden:e.hidden,menu:document.querySelector('#account-menu').hidden,rect:r.toJSON(),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML,ready:document.readyState}})()`)));
  w.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
  w.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 }); await pause(60);
}
app.whenReady().then(async () => {
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}/workspace.html`;
    const make = () => { const w = new BrowserWindow({ width: 1440, height: 950, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); w.showInactive(); windows.push(w); w.webContents.on('console-message', (_e, level, text) => { if (level === 3 && !/503|401|Failed to load resource/.test(text)) errors.push(text); }); return w; };
    const w = make(), other = make();
    for (const view of ['chat', 'agents', 'tutorials']) {
      signed = true; await w.loadURL(`${base}?view=${view}`); await other.loadURL(`${base}?view=${view}`);
      await until(w, "!document.querySelector('#account-popover').hidden"); await until(other, "!document.querySelector('#account-popover').hidden");
      await click(w, '#account-button');
      fs.writeFileSync(path.join(out, `${view}-account.png`), (await w.webContents.capturePage()).toPNG());
      await click(w, '#logout-button'); await until(other, "document.querySelector('#account-popover').hidden");
      assert.equal(await run(w, "document.querySelector('#chat-log').textContent"), '');
      await w.loadURL(`${base}?view=${view}`); await until(w, "!document.querySelector('#login-button').hidden"); checks.push(`${view}: logout, cross-tab, refresh`);
    }
    signed = true; await w.loadURL(base); await until(w, "!document.querySelector('#account-popover').hidden");
    failLogout = true; await click(w, '#account-button'); await click(w, '#logout-button');
    await until(w, "document.querySelector('#account-status').textContent.includes('重试')");
    assert.equal(await run(w, "document.querySelector('#account-popover').hidden"), false); failLogout = false; checks.push('failed logout preserves login and retry');
    let releaseAccount; accountGate = new Promise(r => { releaseAccount = r; });
    await run(w, "window.dispatchEvent(new Event('botgo:account-refresh'))"); await pause(100);
    await click(w, '#logout-button'); releaseAccount(); await pause(200);
    assert.equal(await run(w, "document.querySelector('#account-popover').hidden"), true); checks.push('late account response cannot restore login');
    signed = true; await w.loadURL(base); await other.loadURL(base);
    await until(w, "!document.querySelector('#model-picker').disabled && !document.querySelector('#account-popover').hidden");
    await until(other, "!document.querySelector('#account-popover').hidden");
    await run(w, "document.querySelector('#chat-input').value='fixture';document.querySelector('#chat-form').requestSubmit()");
    await until(w, "document.querySelector('#chat-log').textContent.includes('fixture partial')");
    await click(other, '#account-button'); await click(other, '#logout-button');
    stream?.end('data: {"choices":[{"delta":{"content":"late"}}]}\n\n'); await pause(200);
    assert.equal(await run(w, "document.querySelector('#chat-log').textContent"), '');
    assert.equal(await run(w, "document.querySelector('#stop-chat').hidden"), true); checks.push('logout aborts stream and isolates late completion');
    signed = true; await w.loadURL(base); await other.loadURL(base);
    await until(w, "!document.querySelector('#header-balance').hidden"); await until(other, "!document.querySelector('#account-popover').hidden");
    let releaseCheckout; checkoutGate = new Promise(r => { releaseCheckout = r; });
    await click(w, '#header-balance'); await until(w, "!document.querySelector('[data-subscription-upgrade]').disabled");
    await click(w, '[data-subscription-upgrade]'); await click(other, '#account-button'); await click(other, '#logout-button');
    releaseCheckout(); checkoutGate = null; await pause(250);
    assert.equal(await run(w, "document.querySelector('#subscription-dialog').open"), false);
    assert.equal(await run(w, "document.querySelector('#subscription-payment-status').textContent"), ''); checks.push('late checkout cannot reopen billing or restore account');
    for (const theme of ['light', 'dark']) for (const width of [1440, 390, 360]) {
      w.setContentSize(width, 900); await w.loadURL(`${base}?view=agents`);
      await run(w, `document.documentElement.dataset.theme='${theme}'`); await pause(120);
      assert.equal(await run(w, 'document.documentElement.scrollWidth <= innerWidth'), true, `overflow ${width} ${theme}`);
      fs.writeFileSync(path.join(out, `agents-${width}-${theme}.png`), (await w.webContents.capturePage()).toPNG());
      for (const guide of ['web', 'account', 'cli', 'faq']) {
        await w.loadURL(`${base}?view=tutorials&guide=${guide}`);
        await run(w, `document.documentElement.dataset.theme='${theme}'`); await pause(120);
        assert.equal(await run(w, 'document.documentElement.scrollWidth <= innerWidth'), true, `guide overflow ${width} ${theme} ${guide}`);
        assert.equal(await run(w, `getComputedStyle(document.querySelector('[data-guide-panel="${guide}"]')).display !== 'none'`), true);
        fs.writeFileSync(path.join(out, `guide-${guide}-${width}-${theme}.png`), (await w.webContents.capturePage()).toPNG());
      }
    }
    checks.push('installation layout at 1440/390/360 in light and dark'); assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ at: new Date().toISOString(), checks, errors, logoutCount }, null, 2));
    console.log('Logout browser checks passed'); for (const win of windows) win.destroy(); server.close(); setTimeout(() => app.exit(0), 200);
  } catch (error) { console.error(error); fs.writeFileSync(path.join(out, 'failure.txt'), error.stack); for (const win of windows) win.destroy(); server.close(); setTimeout(() => app.exit(1), 200); }
});
