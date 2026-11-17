import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { handlePlatformRoute } from '../worker/src/platform-admin.js';

const db = new DatabaseSync(':memory:');
db.exec(fs.readFileSync('worker/migrations/0010_desktop_releases.sql', 'utf8'));
const rows = [
  ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '1.3.6', 'published', 100],
  ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '1.3.5', 'draft', 100],
  ['cccccccc-cccc-4ccc-8ccc-cccccccccccc', '1.3.7', 'draft', 100],
  ['dddddddd-dddd-4ddd-8ddd-dddddddddddd', '1.3.8-beta', 'draft', 100],
  ['eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '1.3.9', 'draft', 101],
];
for (const [id, version, status, size] of rows) {
  db.prepare('INSERT INTO desktop_releases(id,version,object_key,file_name,size_bytes,sha256,status) VALUES(?,?,?,?,?,?,?)')
    .run(id, version, `desktop/${version}/installer.exe`, `BotGo-${version}.exe`, size, 'a'.repeat(64), status);
}

const env = {
  AUTH_SECRET: 'release-test-secret',
  DB: {
    prepare(sql) {
      return {
        first: async () => db.prepare(sql).get(),
        bind(...args) {
          return {
            first: async () => db.prepare(sql).get(...args),
            run: async () => db.prepare(sql).run(...args),
          };
        },
      };
    },
    async batch(statements) {
      db.exec('BEGIN');
      try {
        const result = [];
        for (const statement of statements) result.push(await statement.run());
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  },
  DESKTOP_RELEASES: { head: async () => ({ size: 100 }) },
};
const helpers = {
  activeAdminFor: async () => ({ id: 'admin' }),
  sessionFor: async () => ({ sub: 'account' }),
  audit: async () => {},
};
const publish = (id) => handlePlatformRoute(
  new Request(`https://botgo.win/api/admin/desktop/releases/${id}/publish`, { method: 'POST' }),
  env, `/admin/desktop/releases/${id}/publish`, helpers,
);
const current = () => db.prepare("SELECT version FROM desktop_releases WHERE status='published'").get()?.version;

assert.equal((await publish(rows[1][0])).status, 409, 'an older draft cannot replace the live installer');
assert.equal(current(), '1.3.6');
assert.equal((await publish(rows[3][0])).status, 409, 'a version unsupported by the client cannot be published');
assert.equal((await publish(rows[4][0])).status, 409, 'R2 size must match the release record');
assert.equal((await publish(rows[2][0])).status, 200);
assert.equal(current(), '1.3.7');
assert.equal(db.prepare('SELECT status FROM desktop_releases WHERE id=?').get(rows[0][0]).status, 'retired');
assert.equal((await publish(rows[2][0])).status, 200, 'publishing the current record is idempotent');
const publicRelease = await handlePlatformRoute(
  new Request('https://botgo.win/api/desktop/releases/current'), env, '/desktop/releases/current', helpers,
);
assert.equal((await publicRelease.json()).release.version, '1.3.7');
assert.equal((await publish(rows[0][0])).status, 409, 'an older retired release cannot silently roll back a current release');
assert.equal(current(), '1.3.7');

console.log('Desktop release publication: downgrade, unsupported version, size mismatch, current metadata and idempotency passed');

const hermesId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
db.prepare('INSERT INTO desktop_releases(id,version,platform,object_key,file_name,size_bytes,sha256,status) VALUES(?,?,?,?,?,?,?,?)')
  .run(hermesId, '2.0.0-preview.1', 'win-x64-hermes', 'hermes/preview.exe', 'BotGo-Hermes.exe', 100, 'a'.repeat(64), 'draft');
assert.equal((await publish(hermesId)).status, 200);
assert.equal(db.prepare("SELECT version FROM desktop_releases WHERE platform='win-x64' AND status='published'").get().version, '1.3.7');
const channelRelease = async engine => handlePlatformRoute(new Request('https://botgo.win/api/desktop/releases/current', { headers: { 'x-botgo-client-engine': engine } }), env, '/desktop/releases/current', helpers);
const hermesRelease = await (await channelRelease('hermes')).json();
assert.equal(hermesRelease.engine, 'hermes');
assert.equal(hermesRelease.release.version, '2.0.0-preview.1');
assert.equal(hermesRelease.release.engine, 'hermes');
assert.equal((await (await channelRelease('opencode')).json()).release.version, '1.3.7');
assert.equal((await channelRelease('unknown')).status, 400);
console.log('Hermes/OpenCode release channels remain independent');
