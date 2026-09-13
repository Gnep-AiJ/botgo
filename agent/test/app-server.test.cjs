const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAppServerRunner } = require('../lib/app-server.cjs');
function fixture(overrides = {}) {
  const child = new EventEmitter(), messages = [], events = [];
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  child.stdin.end = () => {}; child.kill = () => {};
  const emit = m => child.stdout.emit('data', Buffer.from(JSON.stringify(m) + '\n'));
  child.stdin.write = data => {
    const m = JSON.parse(data); messages.push(m);
    if (!m.method || !m.id) return;
    queueMicrotask(() => {
      let result = {};
      if (m.method === 'windowsSandbox/readiness') result = { status: 'ready' };
      if (m.method.startsWith('thread/')) result = { thread: { id: 'native-thread' } };
      if (m.method === 'turn/start') result = { turn: { id: 'turn-1' } };
      emit({ id: m.id, result });
    });
  };
  const task = createAppServerRunner({ command: 'codex', spawnImpl: () => child }).start({ id: 'local-thread', projectPath: process.cwd(), codexHome: process.cwd(), relayKey: 'bgk_test', relayOrigin: 'https://botgo.win', model: 'gpt-5.6-sol', prompt: 'inspect', permission: 'workspace-write', onEvent: e => events.push(e), ...overrides });
  return { task, events, emit, child, messages, ready: () => new Promise(resolve => setImmediate(resolve)) };
}
test('app server initializes, resumes, streams Unicode and ignores unrelated threads', async () => {
  const f = fixture({ sessionId: 'existing' }); await f.ready();
  assert.equal(f.messages.find(m => m.method === 'thread/resume').params.threadId, 'existing');
  f.emit({ method: 'item/agentMessage/delta', params: { threadId: 'other', turnId: 'turn-1', itemId: 'a', delta: 'wrong' } });
  const bytes = Buffer.from(JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'native-thread', turnId: 'turn-1', itemId: 'a', delta: '中文正常' } }) + '\n');
  for (const b of bytes) f.child.stdout.emit('data', Buffer.from([b]));
  assert.deepEqual(f.events.filter(e => e.type === 'delta').map(e => e.delta), ['中文正常']);
  f.emit({ method: 'turn/completed', params: { threadId: 'native-thread', turn: { id: 'turn-1', status: 'completed' } } });
  assert.equal((await f.task.promise).type, 'completed');
});
test('approvals cannot be replayed or answered after cancellation', async () => {
  const f = fixture(); await f.ready();
  const request = { id: 99, method: 'item/commandExecution/requestApproval', params: { threadId: 'native-thread', turnId: 'turn-1', itemId: 'c', command: 'inspect' } };
  f.emit(request); f.task.respond({ requestId: '99', decision: 'decline' });
  assert.equal(f.messages.at(-1).result.decision, 'decline');
  assert.throws(() => f.task.respond({ requestId: '99', decision: 'accept' }));
  f.emit({ ...request, id: 100 }); f.task.stop();
  assert.throws(() => f.task.respond({ requestId: '100', decision: 'accept' }));
  f.emit({ method: 'turn/completed', params: { threadId: 'native-thread', turn: { id: 'turn-1', status: 'interrupted' } } });
  assert.equal((await f.task.promise).type, 'stopped');
});
test('questions validate all answers; unknown methods are never auto-approved', async () => {
  const f = fixture(); await f.ready();
  f.emit({ id: 10, method: 'item/tool/requestUserInput', params: { threadId: 'native-thread', turnId: 'turn-1', itemId: 'q', questions: [{ id: 'a', question: 'Choose' }] } });
  assert.throws(() => f.task.respond({ requestId: '10', answers: {} }));
  f.task.respond({ requestId: '10', answers: { a: { answers: ['yes'] } } });
  assert.deepEqual(f.messages.at(-1).result, { answers: { a: { answers: ['yes'] } } });
  f.emit({ id: 11, method: 'unknown/action', params: {} }); assert.equal(f.messages.at(-1).error.code, -32601);
  f.child.emit('close'); assert.equal((await f.task.promise).type, 'error');
});
test('read-only never permits elevation', async () => {
  const f = fixture({ permission: 'read-only' }); await f.ready();
  assert.equal(f.messages.find(m => m.method === 'thread/start').params.approvalPolicy, 'never');
  f.emit({ id: 12, method: 'item/permissions/requestApproval', params: { threadId: 'native-thread', turnId: 'turn-1', permissions: { fileSystem: { write: ['C:/'] } } } });
  assert.throws(() => f.task.respond({ requestId: '12', decision: 'accept' }));
  f.task.respond({ requestId: '12', decision: 'decline' }); assert.deepEqual(f.messages.at(-1).result.permissions, {});
  f.child.emit('close'); await f.task.promise;
});
