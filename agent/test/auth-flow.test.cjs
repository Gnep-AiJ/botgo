const assert = require("node:assert/strict");
const test = require("node:test");

const { login } = require("../lib/cli.cjs");

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
