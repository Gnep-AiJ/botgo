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
