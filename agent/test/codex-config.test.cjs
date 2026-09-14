const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { managedConfig, providerArguments, writeCodexConfig } = require('../lib/codex-config.cjs');

test('managed provider enables native API-key review while keeping the relay key in the environment', () => {
  const config = managedConfig('https://botgo.win');
  assert.match(config, /env_key = "BOTGO_CODEX_API_KEY"/);
  assert.match(config, /requires_openai_auth = true/);
  assert.doesNotMatch(config, /bgk_/);
  assert.ok(providerArguments('https://botgo.win').includes('model_providers.botgo.requires_openai_auth=true'));
});

test('isolated Codex home gets only a non-secret auth marker and preserves existing auth', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'botgo-config-test-'));
  try {
    writeCodexConfig({ codexHome: home, relayOrigin: 'https://botgo.win' });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')), { auth_mode: 'apikey', OPENAI_API_KEY: 'botgo-managed-by-environment' });
    fs.writeFileSync(path.join(home, 'auth.json'), JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'preserve-existing' }));
    writeCodexConfig({ codexHome: home, relayOrigin: 'https://botgo.win' });
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, 'auth.json'), 'utf8')).OPENAI_API_KEY, 'preserve-existing');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});
