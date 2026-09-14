const assert = require('node:assert/strict');
const fs = require('node:fs');

const prepare = fs.readFileSync('opencode-desktop/prepare.mjs', 'utf8');
const installer = fs.readFileSync('opencode-desktop/installer.cjs', 'utf8');
const authorize = fs.readFileSync('opencode-desktop/runtime/authorize.cjs', 'utf8');

assert.match(prepare, /pkg\.version='1\.3\.0-preview\.1'/);
assert.match(prepare, /pkg\.name='@botgo\/desktop'/);
assert.match(installer, /appId: 'com\.botgo\.desktop'/);
assert.match(installer, /productName: 'BotGo Desktop'/);
assert.match(installer, /schemes: \['botgo'\]/);
assert.doesNotMatch(authorize, /BotGo OpenCode Desktop/);
assert.match(authorize, /deviceLabel:'BotGo Desktop'/);

console.log('Native release identity: version, product, protocol and device label passed');
