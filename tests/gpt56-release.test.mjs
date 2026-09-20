import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const workspace = read('workspace.html');
const client = read('product-account.js');
const download = read('download.js');
const worker = read('worker/src/index.js');
const workerConfig = read('worker/wrangler.jsonc');
const metering = read('worker/src/metering.js');
const gateway = read('worker/src/opencode-gateway.js');
const nativeBridge = read('opencode-desktop/runtime/bridge.cjs');
const build = read('scripts/build.mjs');

assert.doesNotMatch(workspace, /id="model-picker"|id="chat-form"/);
assert.doesNotMatch(workspace, /\/downloads\/BotGo-Desktop-Setup\.exe/);
assert.doesNotMatch(client, /activeProvider|provider:\s*activeProvider|claude-sonnet/);
assert.match(download, /\/desktop\/releases\/current/);
assert.match(worker, /publicCatalog\(data,\{autoReview:desktop\?await autoReviewCapability\(env,data\):false\}\)/);
assert.doesNotMatch(worker, /proxyClaudeMessages|\/v1\/messages|ANTHROPIC_/);
assert.doesNotMatch(workerConfig, /ANTHROPIC_/);
assert.match(metering, /AUTO_REVIEW_BILLING_MODEL_ID = 'gpt-5\.6-luna'/);
assert.match(metering, /\['gpt-5\.6-sol','GPT-5\.6 Sol'/, 'Sol must remain in the server-owned model catalog');
assert.match(gateway, /const usableMember = member => Boolean\(member\.enabled&&member\.verified_at&&!member\.blocked_reason\)/, 'native members must be verified and unblocked');
assert.match(gateway, /r\.enabled && r\.model_enabled && r\.agent_enabled && r\.members\?\.some\(usableMember\)/, 'native model availability must require an enabled route with a usable member');
assert.match(nativeBridge, /const models=session\.models\.filter/, 'the native client must configure only session-provided models');
assert.match(nativeBridge, /Model or protocol not available/, 'the local bridge must reject a model absent from the verified session catalog');
assert.doesNotMatch(metering, /AUTO_REVIEW_TEMPLATE|Codex Auto Review/);
assert.doesNotMatch(build, /installer\/botgo-bootstrap/);
assert.equal(exists('installer/botgo-bootstrap.ps1'), false);
assert.equal(exists('installer/botgo-bootstrap.sh'), false);
assert.equal(exists('server'), false);
assert.equal(exists('deploy'), false);
assert.equal(exists('VPS_DEPLOYMENT.md'), false);

console.log('GPT-5.6 model routing and release boundary test passed');
