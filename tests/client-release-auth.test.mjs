import assert from 'node:assert/strict';
import { handlePlatformRoute } from '../worker/src/platform-admin.js';
const deviceToken = 'bgdt_' + 'a'.repeat(32);
const digest = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(deviceToken))).toString('base64url');
let revoked = false, inactive = false;
const release = { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', version: '1.3.1', size_bytes: 20, sha256: 'a'.repeat(64), file_name: 'BotGo-1.3.1-win-x64.exe' };
const env = { AUTH_SECRET: 'isolated-test-secret', DB: { prepare(sql) {
  const first = async values => {
    if (sql.includes('FROM device_tokens')) return values[0] === digest && !revoked ? { account_id: 'account', expires_at: '2099-01-01T00:00:00Z', revoked_at: revoked ? 'now' : null } : null;
    if (sql.includes('FROM accounts')) return { id: 'account', status: inactive ? 'disabled' : 'active', credit_balance: 100 };
    if (sql.includes('FROM desktop_releases')) return release;
    throw Error('Unexpected query');
  };
  return { first: () => first([]), bind: (...values) => ({ first: () => first(values) }) };
} } };
const route = (authorization, session = null) => handlePlatformRoute(new Request('https://botgo.win/api/desktop/releases/current', { headers: authorization ? { authorization } : {} }), env, '/desktop/releases/current', { sessionFor: async () => session });
assert.equal((await route()).status, 401);
assert.equal((await route('Bearer bgdt_invalid')).status, 401);
const good = await route('Bearer ' + deviceToken); assert.equal(good.status, 200); const body = await good.json(); assert.ok(body.release.downloadUrl.includes('account=account')); assert.ok(body.release.downloadUrl.includes('token='));
revoked = true; assert.equal((await route('Bearer ' + deviceToken)).status, 401); revoked = false;
inactive = true; assert.equal((await route('Bearer ' + deviceToken)).status, 403);
assert.equal((await route(null, { sub: 'web-account' })).status, 200);
console.log('Native client update authorization: device, revoked, inactive, anonymous and web session passed');
