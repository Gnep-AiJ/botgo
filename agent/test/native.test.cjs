const test = require('node:test'), assert = require('node:assert/strict');
const path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const { EventEmitter } = require('node:events');
const { openNativeTerminal, runtimeEnvironment, interactiveEnvironment } = require('../lib/native.cjs');
const home = path.resolve('.tmp-native-home');
test('TERM repair is limited to confirmed Windows interactive children', () => {
  const base = { TERM: 'dumb', OPENAI_API_KEY: 'unrelated', CODEX_HOME: 'unrelated' };
  assert.equal(runtimeEnvironment(home, 'bgk_fixture', base).TERM, 'dumb');
  for (const [platform, isTTY, expected] of [['win32', true, 'xterm-256color'], ['win32', false, 'dumb'], ['linux', true, 'dumb']]) {
    const env = interactiveEnvironment(home, 'bgk_fixture', base, { platform, isTTY });
    assert.equal(env.TERM, expected); assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.CODEX_HOME, home);
  }
  assert.equal(base.TERM, 'dumb'); assert.equal(base.OPENAI_API_KEY, 'unrelated');
});
for (const mode of ['ready', 'early-exit', 'spawn-error', 'timeout']) test(`native launch ${mode}`, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "botgo-'$`& "));
  const statuses = []; let spawned;
  try {
    const pending = openNativeTerminal({ command: path.join(dir, "codex 'test.exe"), projectPath: dir, codexHome: home, relayKey: 'bgk_fixture', relayOrigin: 'https://botgo.win', model: 'gpt-5.6-sol', sessionId: 'session-1', settleMs: 5, readyTimeoutMs: 40, onStatus: value => statuses.push(value.state),
      spawnImpl(exe, args, options) {
        spawned = { exe, args, options }; const child = new EventEmitter(); child.stdout = new EventEmitter();
        queueMicrotask(() => {
          child.emit('spawn');
          if (mode === 'spawn-error') child.emit('error', Error('spawn failed'));
          if (mode === 'ready' || mode === 'early-exit') child.stdout.emit('data', Buffer.from('CREATED\r\nREA'));
          if (mode === 'ready' || mode === 'early-exit') child.stdout.emit('data', Buffer.from('DY\r\n'));
          if (mode === 'early-exit') child.emit('close', 1);
          if (mode === 'ready') setTimeout(() => child.emit('close', 0), 15);
        }); return child;
      }
    });
    if (mode === 'ready') { assert.deepEqual(await pending, { opened: true, consoleReady: true }); await new Promise(r => setTimeout(r, 25)); assert.deepEqual(statuses, ['starting', 'running', 'idle']); }
    else await assert.rejects(pending, /启动失败|spawn failed|时限/);
    const helper = Buffer.from(spawned.args.at(-1), 'base64').toString('utf16le');
    const encoded = helper.match(/::Run\('[^']*', '([^']+)'/)[1];
    const terminal = Buffer.from(encoded, 'base64').toString('utf16le');
    assert.ok(terminal.includes(dir.replaceAll("'", "''"))); assert.match(terminal, /'resume' 'session-1'/);
    assert.doesNotMatch(helper + terminal, /bgk_fixture/); assert.equal(spawned.options.env.BOTGO_CODEX_API_KEY, 'bgk_fixture');
    assert.equal(spawned.options.windowsHide, true); assert.match(helper, /false, 0x00000010/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
