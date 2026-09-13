// Actual Chromium rendering with isolated API/clipboard fixtures; no user login.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..'), out = path.join(root, 'artifacts/verification/install-ui');
fs.mkdirSync(out, { recursive: true }); app.setPath('userData', path.join(out, 'profile')); app.disableHardwareAcceleration();
let signed = true, failure = false, gate = null;
const errors = [], checks = [];
const server = http.createServer(async (req, res) => {
  const route = new URL(req.url, 'http://localhost').pathname;
  const send = (body, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (!route.startsWith('/api/')) {
    const file = path.resolve(root, 'dist', '.' + (route === '/' ? '/workspace.html' : route));
    if (!file.startsWith(path.join(root, 'dist') + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp' })[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file)); return;
  }
  if (route === '/api/models') return send({ defaultModel: 'gpt-5.6-sol', models: [{ id: 'gpt-5.6-sol', name: 'Sol', enabled: true, web: true }] });
  if (route === '/api/account') return send(signed ? { account: { id: 'fixture', email: 'test@example.invalid', balanceCents: 100 } } : { error: '请先登录' }, signed ? 200 : 401);
  if (route === '/api/auth/logout') { signed = false; return send({ ok: true }); }
  if (route === '/api/conversations') return send({ conversations: [], hasMore: false });
  if (route === '/api/desktop/releases/current') {
    if (gate) await gate;
    if (failure) return send({ error: '版本服务暂不可用' }, 503);
    return send({ release: { version: '1.2.1-preview.3-fixture', downloadUrl: '/api/desktop/releases/fixture/download' } });
  }
  if (route === '/api/desktop/releases/fixture/download') { res.end('fixture-installer'); return; }
  return send({});
});
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const run = (w, js) => w.webContents.executeJavaScript(js, true);
async function until(w, js) { for (let i = 0; i < 100; i++) { if (await run(w, js)) return; await pause(50); } throw Error('Timed out: ' + js); }
async function click(w, selector) {
  const point = await run(w, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);
  w.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
  w.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 }); await pause(80);
}
app.whenReady().then(async () => {
  const timeout = setTimeout(() => { console.error('UI verification timed out'); app.exit(1); }, 90000);
  const w = new BrowserWindow({ width: 1440, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } }); w.showInactive();
  w.webContents.on('console-message', (_e, level, text) => { if (level === 3 && !/503|401|Failed to load resource/.test(text)) errors.push(text); });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/workspace.html`;
    for (const theme of ['light', 'dark']) for (const width of [1440, 390, 360]) for (const view of ['agents', 'tutorials', 'chat']) {
      w.setContentSize(width, 960); await w.loadURL(`${base}?view=${view}&guide=cli`);
      await run(w, `localStorage.setItem('botgo-theme','${theme}')`); await w.reload();
      await until(w, `document.readyState==='complete' && document.documentElement.dataset.theme==='${theme}'`);
      await pause(120);
      const info = await run(w, `(()=>{const h=document.querySelector('.work-start-title');return {width:innerWidth,view:document.body.dataset.activeView,theme:document.documentElement.dataset.theme,overflow:document.documentElement.scrollWidth>innerWidth,first:document.querySelector('.agent-choices>article').className,projectExample:!!document.querySelector('[data-copy-project]'),spacing:parseFloat(getComputedStyle(h).letterSpacing)/parseFloat(getComputedStyle(h).fontSize)};})()`);
      assert.equal(info.width, width); assert.equal(info.overflow, false); assert.match(info.first, /--desktop/); assert.equal(info.projectExample, false); assert.ok(Math.abs(info.spacing - 0.02) < 0.001);
      if (view === 'agents') {
        await until(w, `document.querySelector('#desktop-version-summary').textContent.includes('fixture')`);
        await run(w, `Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async text=>{window.copied=text}})`);
        await click(w, '[data-copy-install]');
        assert.equal(await run(w, 'window.copied'), 'irm https://botgo.win/install.ps1 | iex');
        assert.match(await run(w, `document.querySelector('[data-install-status]').textContent`), /已复制/);
        await run(w, `document.querySelector('[data-copy-install]').focus()`);
        w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
        await click(w, '[data-desktop-open]'); await until(w, `!document.querySelector('#desktop-release').hidden`);
        assert.equal(await run(w, `fetch(document.querySelector('#desktop-download-link').href).then(r=>r.text())`), 'fixture-installer');
        await click(w, '#desktop-install-close');
        await run(w, `document.querySelector('[data-view="agents"]').scrollTop=0;document.querySelector('.workspace-main').scrollTop=0;window.scrollTo(0,0)`);
      }
      if (view === 'tutorials') {
        await run(w, `document.querySelector('[data-guide="web"]').focus()`);
        w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'End' }); w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'End' });
        await until(w, `document.activeElement.dataset.guide==='faq' && !document.querySelector('[data-guide-panel="faq"]').hidden`);
      }
      let png;
      for (let attempt = 0; attempt < 10; attempt++) {
        await pause(100); png = (await w.webContents.capturePage()).toPNG();
        if (png.length > 1000) break;
      }
      assert.ok(png.length > 1000, 'Screenshot must contain actual rendered pixels');
      fs.writeFileSync(path.join(out, `${view}-${theme}-${width}.png`), png); checks.push(info);
    }
    signed = false; await w.loadURL(`${base}?view=agents`); await click(w, '[data-desktop-open]');
    await until(w, `!document.querySelector('#desktop-download-login').hidden`);
    await click(w, '#desktop-download-login'); assert.equal(await run(w, `document.querySelector('#auth-dialog').open`), true);
    signed = true; failure = true; await w.loadURL(`${base}?view=agents`);
    await until(w, `document.querySelector('#desktop-version-summary').textContent.includes('失败')`);
    await click(w, '[data-desktop-open]'); await until(w, `!document.querySelector('#desktop-download-retry').hidden`);
    failure = false; let release; gate = new Promise(resolve => { release = resolve; });
    await click(w, '#desktop-download-retry');
    assert.match(await run(w, `document.querySelector('#desktop-install-status').textContent`), /正在获取/);
    release(); gate = null; await until(w, `!document.querySelector('#desktop-release').hidden`);
    await click(w, '#desktop-install-close');
    await run(w, `Object.defineProperty(navigator.clipboard,'writeText',{configurable:true,value:async()=>{throw Error('denied')}})`);
    await click(w, '[data-copy-install]'); assert.match(await run(w, `document.querySelector('[data-install-status]').textContent`), /请选中/);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ checks, errors, downloadStates: ['guest','loading','success','failure','retry'], clipboard: 'isolated API fixture', scope: 'Chromium windows; no actual account or Windows installer acceptance' }, null, 2));
    console.log('PASS: 18 viewport/theme/view combinations, copy, download states and guide keyboard navigation');
    clearTimeout(timeout); w.destroy(); server.close(); app.exit(0);
  } catch (error) { console.error(error); clearTimeout(timeout); w.destroy(); server.close(); app.exit(1); }
});
