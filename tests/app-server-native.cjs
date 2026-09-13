const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createAppServerRunner } = require('../agent/lib/app-server.cjs');
const { nativeCommand } = require('../agent/lib/native.cjs');
const root = path.resolve('artifacts/verification/app-server/native-' + Date.now());
const project = path.join(root, 'ordinary folder'), codexHome = path.join(root, 'codex');
fs.mkdirSync(project, { recursive: true }); fs.mkdirSync(codexHome, { recursive: true });
let requests = 0;
const server = http.createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  if (!req.url.includes('/responses')) { res.writeHead(404); res.end(); return; }
  const body = JSON.parse(raw); requests++; fs.writeFileSync(path.join(root,'tools.json'),JSON.stringify({keys:Object.keys(body),tools:body.tools||body.response?.tools},null,2));
  const text = 'Native streaming verified ' + requests;
  const item = { id: 'msg_' + requests, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
  const response = { id: 'resp_' + requests, object: 'response', created_at: 1, status: 'completed', model: body.model, output: [item], usage: { input_tokens: 2, output_tokens: 4, total_tokens: 6 } };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const emit = data => res.write('event: ' + data.type + '\ndata: ' + JSON.stringify(data) + '\n\n');
  emit({ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } });
  emit({ type: 'response.output_item.added', output_index: 0, item: { ...item, status: 'in_progress', content: [] } });
  emit({ type: 'response.content_part.added', item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } });
  emit({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, content_index: 0, delta: text });
  emit({ type: 'response.output_text.done', item_id: item.id, output_index: 0, content_index: 0, text });
  emit({ type: 'response.output_item.done', output_index: 0, item });
  emit({ type: 'response.completed', response }); res.end();
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const results = []; let sessionId = '';
  try {
    for (let i = 0; i < 2; i++) {
      const events = [];
      const runner = createAppServerRunner({ command: nativeCommand(), spawnImpl: (cmd, args, opts) => spawn(cmd, [...args, '-c', `model_providers.botgo.base_url="http://127.0.0.1:${server.address().port}"`], opts) });
      const task = runner.start({ id: 'test', projectPath: project, codexHome, relayKey: 'bgk_fixture', relayOrigin: 'https://botgo.win', model: 'gpt-5.6-sol', permission: 'read-only', prompt: i ? 'Continue' : 'Say hello', sessionId, onEvent: event => events.push(event) });
      const timer = setTimeout(() => task.stop(), 45000);
      const result = await task.promise; clearTimeout(timer);
      results.push({ result, events });
      fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify({ requests, results }, null, 2));
      assert.equal(result.type, 'completed', JSON.stringify(events));
      assert.ok(events.some(e => e.type === 'delta'));
      sessionId = result.sessionId;
    }
    assert.equal(requests, 2); console.log('PASS native app-server: ordinary folder, streaming, persisted resume; ' + root);
  } finally { server.closeAllConnections(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
