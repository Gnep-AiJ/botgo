const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createUpdater, newer, parseVersion, validateRelease } = require('../opencode-desktop/runtime/updater.cjs');

const origin = 'https://botgo.win';
const bytes = Buffer.from('verified BotGo installer fixture');
const digest = crypto.createHash('sha256').update(bytes).digest('hex');
const root = fs.mkdtempSync(path.join(path.resolve('artifacts/verification'), 'updater-test-'));
const release = (overrides = {}) => ({
  version: '1.3.1',
  sha256: digest,
  size_bytes: bytes.length,
  downloadUrl: '/api/desktop/releases/release/download?token=fixture',
  ...overrides,
});

assert.equal(newer('1.3.1', '1.3.0-preview.1'), true);
assert.equal(newer('1.3.0-preview.1', '1.3.1'), false);
assert.equal(newer('1.3.1', '1.3.1'), false);
assert.throws(() => parseVersion('1.3'));
assert.throws(() => validateRelease(release({ sha256: 'bad' }), '1.3.0', origin));
assert.throws(() => validateRelease(release({ size_bytes: 0 }), '1.3.0', origin));
assert.throws(() => validateRelease(release({ downloadUrl: 'http://botgo.win/installer.exe' }), '1.3.0', origin));
assert.throws(() => validateRelease(release({ downloadUrl: 'https://evil.invalid/installer.exe' }), '1.3.0', origin));

function makeUpdater(directory, currentRelease, options = {}) {
  const launched = [];
  const stopped = [];
  const verified = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    if (new URL(value, origin).pathname === '/api/desktop/releases/current') return Response.json({ release: currentRelease() });
    if (value.startsWith(origin)) return new Response(options.downloadBytes || bytes);
    throw Error(`Unexpected update URL: ${value}`);
  };
  const updater = createUpdater({
    currentVersion: '1.3.0-preview.1',
    origin,
    directory,
    deviceToken: () => 'bgdt_fixture',
    fetchImpl,
    verifySignature: async (file) => {
      verified.push(file);
      if (options.rejectSignature) throw Error('fixture signature rejection');
    },
    stop: async () => stopped.push(true),
    launch: async (file) => launched.push(file),
  });
  return { updater, launched, stopped, verified };
}

(async () => {
  const good = makeUpdater(path.join(root, 'good'), () => release());
  assert.equal((await good.updater.start()).status, 'ready');
  assert.equal(good.launched.length, 0, 'a background check must never install automatically');
  const installer = path.join(root, 'good', `${digest}.exe`);
  assert.equal(fs.existsSync(installer), true);
  assert.ok(good.verified.length >= 1);
  await good.updater.install();
  assert.deepEqual(good.stopped, [true]);
  assert.deepEqual(good.launched, [installer]);

  const badHash = makeUpdater(path.join(root, 'bad-hash'), () => release({ sha256: '0'.repeat(64) }));
  assert.equal((await badHash.updater.check()).status, 'error');
  assert.equal(fs.readdirSync(path.join(root, 'bad-hash')).length, 0, 'hash failures leave no installer');

  const oversized = makeUpdater(path.join(root, 'oversized'), () => release({ size_bytes: bytes.length - 1 }));
  assert.equal((await oversized.updater.check()).status, 'error');
  assert.equal(fs.readdirSync(path.join(root, 'oversized')).length, 0, 'oversized downloads leave no installer');

  const rejected = makeUpdater(path.join(root, 'signature'), () => release(), { rejectSignature: true });
  assert.equal((await rejected.updater.check()).status, 'error');
  assert.equal(fs.readdirSync(path.join(root, 'signature')).length, 0, 'signature rejection leaves no installer');

  let metadataCalls = 0;
  const changed = makeUpdater(path.join(root, 'changed'), () => {
    metadataCalls += 1;
    return metadataCalls === 1 ? release() : release({ version: '1.3.2', sha256: '1'.repeat(64) });
  });
  assert.equal((await changed.updater.check()).status, 'ready');
  await assert.rejects(() => changed.updater.install(), /available update changed/);
  assert.equal(changed.launched.length, 0, 'changed metadata must prevent installation');
  assert.equal(changed.stopped.length, 0, 'the running client stays open when revalidation fails');

  console.log('BotGo updater: version, origin, hash, size, signature, explicit install and metadata revalidation passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
