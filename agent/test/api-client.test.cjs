const test = require('node:test');
const assert = require('node:assert/strict');
const { createApiClient } = require('../lib/api-client.cjs');

test('API requests abort on deadline instead of waiting indefinitely', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    const api = createApiClient({ timeoutMs: 20, fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }) });
    await assert.rejects(api.models(), { name: 'TimeoutError' });
  } finally { clearTimeout(keepAlive); }
});

test('API request preserves caller cancellation', async () => {
  const controller = new AbortController();
  const api = createApiClient({ fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  const pending = api.request('/models', { signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { name: 'AbortError' });
});

test('issuing a key binds the selected model in the request body', async () => {
  let observed;
  const api = createApiClient({ fetchImpl: async (url, init) => { observed={url,init};return new Response('{"key":"bgk_v2_test"}',{status:201,headers:{'content-type':'application/json'}}); } });
  await api.issueKey('bgdt_device','gpt-5.6-terra');
  assert.equal(observed.init.headers.authorization,'Bearer bgdt_device');
  assert.deepEqual(JSON.parse(observed.init.body),{model:'gpt-5.6-terra'});
});
