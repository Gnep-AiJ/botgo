import assert from 'node:assert/strict';
import { createWebChatRuntime } from './fixtures/web-chat-runtime.mjs';
import { forwardDevApi } from '../scripts/dev-api.mjs';

const runtime = await createWebChatRuntime();
const request = (path, method = 'GET', body, cookie, origin = 'https://botgo.test') => new Request('https://botgo.test/api' + path, {
  method, headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});
try {
  assert.equal((await runtime.pagesFetch(request('/chat/models'))).status, 401);
  const email = 'a@example.invalid';
  assert.equal((await runtime.pagesFetch(request('/auth/request-login-code', 'POST', { email }))).status, 202);
  const login = await runtime.pagesFetch(request('/auth/login', 'POST', { email, code: runtime.codes.get(email) }));
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await runtime.pagesFetch(request('/auth/login', 'POST', { email, code: runtime.codes.get(email) }))).status, 400, 'codes cannot be replayed');
  assert.equal((await runtime.pagesFetch(request('/chat/models', 'GET', undefined, cookie + 'tamper'))).status, 401);
  assert.equal((await runtime.pagesFetch(request('/account', 'GET', undefined, cookie))).status, 200);
  const modelList = await (await runtime.pagesFetch(request('/chat/models', 'GET', undefined, cookie))).json();
  assert.equal(modelList.models.length, 2);
  assert.equal(modelList.capabilities.webSearch, false);
  assert.equal((await runtime.pagesFetch(request('/conversations', 'POST', { topic: 'doctor' }, cookie, 'https://other.test'))).status, 403);
  const doctor = await (await runtime.pagesFetch(request('/conversations', 'POST', { title: '体检指标', topic: 'doctor' }, cookie))).json();
  const before = runtime.db.prepare("SELECT credit_balance*10000+credit_remainder_micros AS n FROM accounts WHERE id='fixture-a'").get().n;
  const body = { conversationId: doctor.id, requestId: crypto.randomUUID(), content: '帮我理解体检指标', model: modelList.models[0].id };
  const answer = await runtime.pagesFetch(request('/chat/stream', 'POST', body, cookie));
  assert.equal(answer.status, 200); assert.match(await answer.text(), /本地联调回答/); await runtime.settle();
  const detail = await (await runtime.pagesFetch(request('/conversations/' + doctor.id, 'GET', undefined, cookie))).json();
  assert.equal(detail.messages.length, 2);
  assert.match(runtime.upstreamCalls[0].messages[0].content, /医学信息助手/);
  assert.equal(runtime.upstreamCalls[0].model, 'fixture-vendor-0');
  assert.equal(runtime.upstreamCalls[0].tools, undefined);
  const usage = await (await runtime.pagesFetch(request('/chat/usage?conversationId=' + doctor.id, 'GET', undefined, cookie))).json();
  assert.equal(usage.requests[0].state, 'completed');
  assert.ok(usage.requests[0].charged_micros > 0);
  const after = runtime.db.prepare("SELECT credit_balance*10000+credit_remainder_micros AS n FROM accounts WHERE id='fixture-a'").get().n;
  assert.equal(before - after, usage.requests[0].charged_micros, 'account and ledger settle the same fee');

  const local = new Request('http://127.0.0.1:4173/api/conversations?topic=doctor', { headers: { cookie } });
  const proxied = await forwardDevApi(local, 'http://127.0.0.1:8787', runtime.workerFetch);
  assert.equal((await proxied.json()).conversations[0].id, doctor.id, 'local bridge reaches the same authenticated history');
  const localWrite = await forwardDevApi(new Request('http://127.0.0.1:4173/api/conversations', {
    method: 'POST', headers: { origin: 'http://127.0.0.1:4173', cookie, 'content-type': 'application/json' }, body: JSON.stringify({ title: '工作', topic: 'tarot' })
  }), 'http://127.0.0.1:8787', runtime.workerFetch);
  assert.equal(localWrite.status, 201);
  assert.equal((await localWrite.json()).context.cards.length, 3);
  assert.equal(runtime.upstreamCalls.length, 1, 'drawing still makes no model request');
  runtime.db.exec("UPDATE accounts SET status='suspended' WHERE id='fixture-a'");
  assert.equal((await runtime.pagesFetch(request('/chat/models', 'GET', undefined, cookie))).status, 401);
  console.log('Pages binding + Worker entry + real session/OTP + SQLite history/routes/ledger + local bridge passed; external SMTP/model transports are isolated fixtures');
} finally { await runtime.settle(); runtime.close(); }
