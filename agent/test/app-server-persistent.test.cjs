const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAppServerRunner } = require('../lib/app-server.cjs');
function harness() {
  const children = [], messages = [], events = []; let turns = 0;
  const runner = createAppServerRunner({ command: 'fixture', requestTimeout: 100,
    spawnImpl() {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
      child.stdin.end = () => {}; child.kill = () => { child.killed = true; };
      child.emitMessage = m => child.stdout.emit('data', Buffer.from(JSON.stringify(m) + '\n'));
      child.stdin.write = data => {
        const m = JSON.parse(data); messages.push(m); if (!m.id || !m.method) return;
        queueMicrotask(() => {
          let result = {};
          if (m.method === 'windowsSandbox/readiness') result = { status: 'ready' };
          if (['thread/start', 'thread/resume'].includes(m.method)) result = { thread: { id: 'native' } };
          if (m.method === 'turn/start') result = { turn: { id: `turn-${++turns}` } };
          child.emitMessage({ id: m.id, result });
        });
      };
      children.push(child); return child;
    }
  });
  const options = { id: 'local', projectPath: process.cwd(), codexHome: process.cwd(), relayKey: 'bgk_fixture', relayOrigin: 'https://botgo.win', model: 'gpt-5.6-sol', permission: 'workspace-write', reviewer: 'auto_review', prompt: 'inspect', onEvent: e => events.push(e) };
  const tick = () => new Promise(r => setImmediate(r));
  const complete = (id, status = 'completed') => children.at(-1).emitMessage({ method: 'turn/completed', params: { threadId: 'native', turn: { id, status } } });
  return { runner, options, messages, events, children, tick, complete };
}
test('continuous turns keep one process and one initialize, with fresh turn policy and native thread', async () => {
  const h = harness(); const first = h.runner.start(h.options); await h.tick(); h.complete('turn-1'); await first.promise;
  assert.equal(h.children[0].killed, undefined);
  const second = h.runner.start({ ...h.options, sessionId: 'native', model: 'gpt-5.5', plan: true }); await h.tick();
  assert.equal(h.children.length, 1); assert.equal(h.messages.filter(m => m.method === 'initialize').length, 1);
  assert.equal(h.messages.filter(m => /^thread\/(start|resume)$/.test(m.method)).length, 1);
  const params = h.messages.filter(m => m.method === 'turn/start').at(-1).params;
  assert.equal(params.model, 'gpt-5.5'); assert.equal(params.approvalsReviewer, 'auto_review'); assert.equal(params.collaborationMode.mode, 'plan');
  h.complete('turn-1'); assert.equal(h.events.filter(e => e.type === 'completed').length, 1, 'late previous turn completion must not finish the new turn');
  h.complete('turn-2'); await second.promise; h.runner.close(); assert.equal(h.children[0].killed, true);
});
test('connection loss stops once and never replays a task', async () => {
  const h = harness(), task = h.runner.start(h.options); await h.tick();
  h.children[0].emit('close'); assert.equal((await task.promise).type, 'error');
  assert.equal(h.runner.connected, false); assert.equal(h.children.length, 1);
  assert.equal(h.messages.filter(m => m.method === 'turn/start').length, 1);
});
test('steering uses expected native turn; stop rejects late responses and preserves transport after interrupt', async () => {
  const h = harness(), task = h.runner.start(h.options); await h.tick();
  await task.steer('additional instruction');
  assert.equal(h.messages.find(m => m.method === 'turn/steer').params.expectedTurnId, 'turn-1');
  task.stop(); await assert.rejects(task.steer('late'));
  h.complete('turn-1', 'interrupted'); assert.equal((await task.promise).type, 'stopped');
  assert.equal(h.runner.connected, true); h.runner.close();
});
test('native auto-review denied events do not cause retries or a wider sandbox', async () => {
  const h = harness(), task = h.runner.start(h.options); await h.tick();
  h.children[0].emitMessage({ method: 'item/autoApprovalReview/completed', params: { threadId: 'native', turnId: 'turn-1', decision: 'denied' } });
  assert.equal(h.events.find(e => e.type === 'review').operation, 'item/autoApprovalReview/completed');
  assert.equal(h.messages.filter(m => m.method === 'turn/start').length, 1);
  assert.equal(h.messages.find(m => m.method === 'turn/start').params.sandboxPolicy.type, 'workspaceWrite');
  h.complete('turn-1'); await task.promise; h.runner.close();
});
test('MCP form content is validated and cancelled requests never grant permissions', async () => {
  const h = harness(), task = h.runner.start(h.options); await h.tick();
  h.children[0].emitMessage({ id: 900, method: 'mcpServer/elicitation/request', params: { threadId: 'native', turnId: 'turn-1', serverName: 'fixture', mode: 'form', message: 'Choose count', requestedSchema: { type: 'object', required: ['count'], properties: { count: { type: 'integer', minimum: 1 } } } } });
  const requestId = h.events.find(e => e.type === 'request').requestId;
  assert.throws(() => task.respond({ requestId, decision: 'accept', content: { count: -1 } }));
  task.respond({ requestId, decision: 'cancel' }); assert.deepEqual(h.messages.at(-1).result, { action: 'cancel' });
  assert.throws(() => task.respond({ requestId, decision: 'accept', content: { count: 1 } }));
  h.complete('turn-1'); await task.promise; h.runner.close();
});
