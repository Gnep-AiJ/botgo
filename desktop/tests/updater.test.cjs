const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createUpdater, newer } = require('../lib/updater.cjs');
test('update versions reject downgrade and treat stable as newer than preview', () => {
  assert.ok(newer('1.2.1-preview.4', '1.2.1-preview.3')); assert.ok(newer('1.2.1', '1.2.1-preview.4'));
  assert.equal(newer('1.2.0', '1.2.1-preview.3'), false); assert.throws(() => newer('../../x', '1.0.0'));
});
test('download verifies size, hash and signature, then rechecks before installing', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'botgo-update-')), bytes = Buffer.from('fixture installer');
  const release = { version: '1.2.1-preview.4', sha256: crypto.createHash('sha256').update(bytes).digest('hex'), size_bytes: bytes.length, downloadUrl: '/api/desktop/releases/id/download' };
  let signatures = 0, requests = 0;
  const updater = createUpdater({ directory, version: '1.2.1-preview.3', origin: 'https://botgo.win', currentRelease: async () => release, verifySignature: async () => { signatures++; }, fetchImpl: async () => { requests++; return new Response(bytes); } });
  try {
    assert.equal((await updater.check()).state, 'ready'); const file = await updater.installer(); assert.ok(signatures >= 2);
    assert.equal((await updater.check()).state, 'ready'); assert.equal(requests, 1);
    fs.writeFileSync(file, 'corrupt'); await assert.rejects(updater.installer());
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
test('bad download and foreign download origin never become installable', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'botgo-update-'));
  const release = { version: '1.2.1-preview.4', sha256: 'a'.repeat(64), size_bytes: 3, downloadUrl: '/download' };
  const updater = createUpdater({ directory, version: '1.2.1-preview.3', origin: 'https://botgo.win', currentRelease: async () => release, verifySignature: async () => {}, fetchImpl: async () => new Response('bad') });
  try { assert.equal((await updater.check()).state, 'error'); await assert.rejects(updater.installer()); assert.deepEqual(fs.readdirSync(directory), []); release.downloadUrl = 'https://other.invalid/file'; assert.equal((await updater.check()).state, 'error'); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
