const assert = require('node:assert/strict');
const fs = require('node:fs');

const prepare = fs.readFileSync('opencode-desktop/prepare.mjs', 'utf8');
const installer = fs.readFileSync('opencode-desktop/installer.cjs', 'utf8');
const authorize = fs.readFileSync('opencode-desktop/runtime/authorize.cjs', 'utf8');

const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
assert.ok(prepare.includes(`pkg.version='${version}'`));
assert.ok(installer.includes(`artifacts/releases/client-${version}`));
assert.match(prepare, /pkg\.name='@botgo\/desktop'/);
assert.match(installer, /appId: 'com\.botgo\.desktop'/);
assert.match(installer, /productName: 'BotGo Desktop'/);
assert.match(installer, /schemes: \['botgo'\]/);
assert.match(installer, /runtime\/verify-signature\.ps1/);
assert.match(fs.readFileSync('opencode-desktop/overlay/botgo-updater.ts','utf8'), /join\(process\.resourcesPath, "botgo", "verify-signature.ps1"\)/);
assert.doesNotMatch(authorize, /BotGo OpenCode Desktop/);
assert.match(authorize, /deviceLabel:'BotGo Desktop'/);

console.log('Native release identity: version, product, protocol and device label passed');
