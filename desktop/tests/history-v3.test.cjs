const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createLocalStateStore } = require('../lib/local-state.cjs');
test('legacy history migrates with backup and preserves more than 200 messages across saves', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'botgo-history-')), filePath = path.join(directory, 'state.json');
  const original = { version: 2, threads: [{ id: 'one', projectPath: directory, sessionId: 'existing-session', messages: Array.from({ length: 350 }, (_, i) => ({ id: String(i), role: 'user', content: 'message ' + i })) }] };
  fs.writeFileSync(filePath, JSON.stringify(original)); const store = createLocalStateStore({ filePath });
  try { const value = store.load(); assert.equal(value.threads[0].collaborationMode, 'default'); value.threads[0].collaborationMode = 'plan'; store.save(value); store.renameThread('one', 'Renamed'); assert.equal(store.load().threads[0].messages.length, 350); assert.equal(store.load().threads[0].sessionId, 'existing-session'); assert.equal(store.load().threads[0].collaborationMode, 'plan'); assert.deepEqual(JSON.parse(fs.readFileSync(filePath + '.pre-v3.bak')), original); assert.equal(JSON.parse(fs.readFileSync(filePath)).threads[0].messages, undefined); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
