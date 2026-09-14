const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path');
const { registerNativePanel } = require('../lib/native-panel.cjs');
function fixture() {
  const handlers = new Map(), calls = []; let response = 0, busy = false;
  registerNativePanel({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
    dialog: { showMessageBox: async () => ({ response }) }, shell: {}, window: () => null,
    state: () => ({ load: () => ({ selectedProject: process.cwd(), threads: [] }) }),
    paths: () => ({ codexHome: path.resolve('artifacts/verification/native-panel-test') }), busy: () => busy,
    ensureRuntime: async () => ({ request: async (method, params) => {
      calls.push({ method, params });
      if (method === 'mcpServerStatus/list') return { data: [{ name: 'known', authStatus: 'unknown', runtimeStatus: 'disabled', tools: {} }] };
      if (method === 'config/read') return { config: { mcp_servers: { known: { env: { PRIVATE_SETTING: 'retained-in-main' }, command: 'old', args: [] } } } };
      return {};
    } })
  });
  return { handlers, calls, invoke: (name, params) => handlers.get(name)(null, params), allow: () => { response = 1; }, busy: () => { busy = true; } };
}
test('MCP confirmation cancellation does not write configuration or launch services', async () => {
  const f = fixture();
  await assert.rejects(f.invoke('mcp:save', { name: 'known', transport: 'stdio', command: 'node', args: [] }), /取消/);
  assert.equal(f.calls.length, 0);
});
test('MCP updates preserve private settings without exposing them in the catalog', async () => {
  const f = fixture(); f.allow();
  const catalog = await f.invoke('extensions:list'); assert.ok(!JSON.stringify(catalog).includes('retained-in-main'));
  await f.invoke('mcp:save', { name: 'known', transport: 'stdio', command: 'node', args: ['server.cjs'] });
  const write = f.calls.find(c => c.method === 'config/value/write');
  assert.equal(write.params.keyPath, 'mcp_servers.known');
  assert.equal(write.params.value.env.PRIVATE_SETTING, 'retained-in-main');
  assert.ok(write.params.filePath.startsWith(path.resolve('artifacts/verification/native-panel-test')));
});
test('renderer cannot supply config paths, arbitrary server IDs or native RPC', async () => {
  const f = fixture(); f.allow();
  await assert.rejects(f.invoke('mcp:save', { name: 'model_providers.botgo', transport: 'stdio', command: 'node', args: [] }));
  await assert.rejects(f.invoke('mcp:toggle', { name: 'unknown', enabled: true }));
  assert.equal(f.handlers.has('native:rpc'), false);
  f.busy(); await assert.rejects(f.invoke('mcp:reconnect'), /停止/);
});
