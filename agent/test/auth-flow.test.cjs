const assert = require("node:assert/strict");
const test = require("node:test");

const { login } = require("../lib/cli.cjs");

test('login prints one authorization prompt without periodic or internal progress', async () => {
  const lines = [];
  const context = { api: { origin: 'https://botgo.win', async startAuthorization() { return { authorizationId: 'test' }; }, async cancelAuthorization() {} }, output: line => lines.push(line) };
  await assert.rejects(login(context, { timeoutMs: 80, progressMs: 5, input: null, openBrowserImpl() {} }), /超时.*重试/);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /浏览器.*授权/);
  assert.match(lines[1], /^登录链接：https:\/\/botgo.win\//);
  assert.match(lines[2], /Ctrl\+C.*Enter/);
  assert.doesNotMatch(lines.join('\n'), /剩余|正在创建|正在连接|BotGo Agent ·/);
});

for (const failure of ['exchange', 'invalid-token', 'credential-store']) test(`callback ${failure} failure closes listener, cancels request and preserves credentials`, async () => {
  let url, cancelled = 0, saved = 0;
  const listeners = process.listenerCount('SIGINT');
  const context = {
    api: { origin: 'https://botgo.win', async startAuthorization() { return { authorizationId: 'test' }; },
      async exchangeAuthorization() { if (failure === 'exchange') throw Error('exchange unavailable'); return { deviceToken: failure === 'invalid-token' ? 'bad' : 'bgdt_test', account: {} }; },
      async cancelAuthorization() { cancelled++; }
    },
    credentialStore: { async save() { if (failure === 'credential-store') throw Error('credential store unavailable'); saved++; } }, output() {}
  };
  const pending = login(context, { timeoutMs: 3000, input: null, openBrowserImpl: value => { url = value; } });
  const rejected = assert.rejects(pending, /unavailable|有效的设备凭据/);
  while (!url) await new Promise(resolve => setImmediate(resolve));
  const page = new URL(url), callback = page.searchParams.get('callback');
  const response = await fetch(`${callback}?state=${page.searchParams.get('state')}&code=bgac_test`);
  assert.equal(response.status, 500);
  assert.match(await response.text(), /授权未完成/);
  await rejected;
  assert.equal(saved, 0); assert.equal(cancelled, 1);
  assert.equal(process.listenerCount('SIGINT'), listeners);
  await assert.rejects(fetch(callback));
});

test('hung browser launch does not hide manual link or cancellation', async () => {
  const lines = [];
  const context = { api: { origin: 'https://botgo.win', async startAuthorization() { return { authorizationId: 'test' }; }, async cancelAuthorization() {} }, output(line) { lines.push(line); if (line.startsWith('登录链接')) setImmediate(() => process.emit('SIGINT')); } };
  await assert.rejects(login(context, { openBrowserImpl: () => new Promise(() => {}) }), /取消/);
  assert.ok(lines.some(line => /登录链接/.test(line)));
});

test('timeout is bounded even when remote cancellation never resolves', async () => {
  let url;
  const context = { api: { origin: 'https://botgo.win', async startAuthorization() { return { authorizationId: 'test' }; }, cancelAuthorization() { return new Promise(() => {}); } }, output() {} };
  await assert.rejects(login(context, { timeoutMs: 40, openBrowserImpl: value => { url = value; } }), /超时/);
  await assert.rejects(fetch(new URL(url).searchParams.get('callback')));
});

test('invalid state and duplicate callback never duplicate credential writes', async () => {
  let url, release, exchanges = 0, saves = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const context = { api: { origin: 'https://botgo.win', async startAuthorization() { return { authorizationId: 'test' }; }, async exchangeAuthorization() { exchanges++; await gate; return { deviceToken: 'bgdt_test', account: { email: 'test@example.invalid' } }; } }, credentialStore: { async save() { saves++; } }, output() {} };
  const pending = login(context, { timeoutMs: 3000, openBrowserImpl: value => { url = value; } });
  while (!url) await new Promise(resolve => setImmediate(resolve));
  const page = new URL(url), callback = page.searchParams.get('callback');
  assert.equal((await fetch(`${callback}?state=incorrect&code=bgac_test`)).status, 400);
  assert.equal(exchanges, 0);
  const address = `${callback}?state=${page.searchParams.get('state')}&code=bgac_test`;
  const first = fetch(address);
  while (!exchanges) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await fetch(address)).status, 409);
  release(); assert.equal((await first).status, 200); await pending;
  assert.equal(exchanges, 1); assert.equal(saves, 1);
});

test('browser launcher failure leaves a usable manual link and can be cancelled', async () => {
  const lines = [];
  const context = { api: { origin: 'https://botgo.win', async startAuthorization() { return { authorizationId: 'test' }; }, async cancelAuthorization() {} }, output(line) { lines.push(line); if (line.startsWith('登录链接')) setImmediate(() => process.emit('SIGINT')); } };
  await assert.rejects(login(context, { openBrowserImpl() { throw Error('launcher failed'); } }), /取消/);
  assert.ok(lines.some(line => /无法自动打开/.test(line)));
  assert.ok(lines.some(line => /登录链接/.test(line)));
});

test('cancel during exchange prevents a late response from storing credentials', async () => {
  let url, release, exchanges = 0, saves = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const context = { api: { origin: 'https://botgo.win', async startAuthorization() { return { authorizationId: 'test' }; }, async exchangeAuthorization() { exchanges++; await gate; return { deviceToken: 'bgdt_test', account: {} }; }, async cancelAuthorization() {} }, credentialStore: { async save() { saves++; } }, output() {} };
  const pending = login(context, { timeoutMs: 3000, openBrowserImpl: value => { url = value; } });
  while (!url) await new Promise(resolve => setImmediate(resolve));
  const page = new URL(url);
  const response = fetch(`${page.searchParams.get('callback')}?state=${page.searchParams.get('state')}&code=bgac_test`);
  while (!exchanges) await new Promise(resolve => setImmediate(resolve));
  process.emit('SIGINT'); await assert.rejects(pending, /取消/);
  release(); assert.equal((await response).status, 410); assert.equal(saves, 0);
});

for(const mode of ['timeout','cancel'])test(`browser login ${mode} closes callback and permits retry`,async()=>{
  let cancelled=0,url='';const count=process.listenerCount('SIGINT');
  const context={api:{origin:'https://botgo.win',async startAuthorization(){return {authorizationId:'test'};},async cancelAuthorization(){cancelled++;}},credentialStore:{save(){throw Error('must not save');}},output(){}};
  const pending=login(context,{timeoutMs:30,openBrowserImpl:value=>{url=value;if(mode==='cancel')setImmediate(()=>process.emit('SIGINT'));}});
  await assert.rejects(pending,mode==='timeout'?/超时/:/取消/);assert.ok(cancelled>=1);assert.equal(process.listenerCount('SIGINT'),count);
  await assert.rejects(fetch(new URL(url).searchParams.get('callback')));
});

test("browser login exchanges the one-time callback and stores only the device token", async () => {
  let browserUrl = "";
  let saved = null;
  const context = {
    api: {
      origin: "https://botgo.win",
      async startAuthorization(body) {
        assert.match(body.verifier, /^[A-Za-z0-9_-]{16,256}$/);
        return { authorizationId: "auth-1" };
      },
      async exchangeAuthorization(body) {
        assert.equal(body.authorizationId, "auth-1");
        assert.match(body.authorizationCode, /^bgac_/);
        assert.equal(body.verifier.length >= 16, true);
        return { deviceToken: "bgdt_device", account: { email: "alice@example.com" } };
      },
      async cancelAuthorization() { throw new Error("should not cancel a successful login"); }
    },
    credentialStore: {
      async save(value) { saved = value; }
    },
    output() {}
  };
  const pending = login(context, { openBrowserImpl(url) { browserUrl = url; }, timeoutMs: 3000 });
  for (let attempt = 0; attempt < 50 && !browserUrl; attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(browserUrl, "login should open an authorization page");
  const page = new URL(browserUrl);
  page.searchParams.set("code", "bgac_code");
  const response = await fetch(page.searchParams.get("callback") + `?code=${page.searchParams.get("code")}&state=${page.searchParams.get("state")}`);
  assert.equal(response.status, 200);
  const account = await pending;
  assert.equal(account.email, "alice@example.com");
  assert.deepEqual(saved, { deviceToken: "bgdt_device" });
});
