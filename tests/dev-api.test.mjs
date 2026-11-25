import assert from 'node:assert/strict';
import { forwardDevApi, localApiOrigin } from '../scripts/dev-api.mjs';

assert.equal(localApiOrigin(undefined), null);
assert.equal(localApiOrigin('http://127.0.0.1:8787'), 'http://127.0.0.1:8787');
for (const value of ['https://botgo.win', 'http://example.com', 'http://127.0.0.1:8787/path', 'http://name:secret@localhost', 'http://localhost?token=x']) {
  assert.throws(() => localApiOrigin(value));
}
const origin = 'http://127.0.0.1:4173';
const request = (path, options = {}) => new Request(origin + path, options);
assert.equal((await forwardDevApi(request('/api/account'), null)).status, 503);
let calls = 0;
const backend = async req => {
  calls++;
  assert.equal(req.url, 'http://127.0.0.1:8787/conversations?topic=doctor');
  assert.equal(req.headers.get('origin'), 'http://127.0.0.1:8787');
  assert.equal(req.headers.get('cookie'), 'botgo_session=fixture');
  assert.equal(req.headers.get('x-hop'), null);
  assert.equal(req.headers.get('accept-encoding'), 'identity');
  assert.deepEqual(await req.json(), { topic: 'doctor' });
  return Response.json({ ok: true }, { status: 201, headers: { 'set-cookie': 'botgo_session=fixture; HttpOnly; Secure; SameSite=Lax', connection: 'keep-alive' } });
};
const reply = await forwardDevApi(request('/api/conversations?topic=doctor', {
  method: 'POST', headers: { origin, cookie: 'botgo_session=fixture', 'content-type': 'application/json', connection: 'x-hop', 'x-hop': 'drop', 'accept-encoding': 'gzip, br' }, body: JSON.stringify({ topic: 'doctor' })
}), 'http://127.0.0.1:8787', backend);
assert.equal(reply.status, 201);
assert.match(reply.headers.get('set-cookie'), /HttpOnly; Secure/);
assert.equal(reply.headers.get('cache-control'), 'no-store');
assert.equal(reply.headers.get('connection'), null);
for (const headers of [{ origin: 'https://other.test' }, { origin, 'sec-fetch-site': 'cross-site' }]) {
  assert.equal((await forwardDevApi(request('/api/conversations', { method: 'POST', headers }), 'http://127.0.0.1:8787', backend)).status, 403);
}
assert.equal(calls, 1, 'cross-site writes never reach the Worker');
assert.equal((await forwardDevApi(request('/api/account'), 'http://127.0.0.1:8787', async () => { throw new Error('private backend details'); })).status, 503);

let cancelled = false;
const abort = new AbortController();
let downstreamSignal;
const stream = await forwardDevApi(request('/api/chat/stream', { method: 'POST', headers: { origin }, signal: abort.signal }), 'http://127.0.0.1:8787', async req => {
  downstreamSignal = req.signal;
  return new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: first\n\n')); },
    cancel() { cancelled = true; }
  }), { headers: { 'content-type': 'text/event-stream' } });
});
const reader = stream.body.getReader();
assert.equal(new TextDecoder().decode((await reader.read()).value), 'data: first\n\n', 'SSE passes through without waiting for the entire answer');
await reader.cancel();
assert.equal(cancelled, true);
abort.abort();
assert.equal(downstreamSignal.aborted, true, 'disconnect propagates to upstream request');
console.log('Local API bridge: cookie/body/query forwarding, origin guard, errors, unbuffered SSE and cancellation passed');
