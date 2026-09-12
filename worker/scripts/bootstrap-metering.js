// One-time deployment entrypoint. Never use this as the normal Worker main.
// Run only during the authorized maintenance window, then remove its cron.
import { encryptSecret, probeProfile } from '../src/platform-admin.js';
import { MODEL_SEEDS } from '../src/metering.js';

export async function bootstrap(env) {
  if (env.BOTGO_MAINTENANCE !== '1' || env.BOTGO_RELEASE_BOOTSTRAP !== '2026-09-12') return;
  // Existing audit PK is an atomic, permanent single-run lock across cron invocations.
  await env.DB.prepare('SELECT id FROM model_catalog LIMIT 1').all();
  const job = 'release-2026-09-12-metering';
  const lock = await env.DB.prepare("INSERT OR IGNORE INTO security_audit(id,event,metadata) VALUES(?,'release_bootstrap_started','{}')").bind(job).run();
  if (!lock.meta.changes) return;
  try {
    const existing = await env.DB.prepare('SELECT id FROM upstream_profiles LIMIT 1').first();
    const routes = await env.DB.prepare('SELECT channel FROM upstream_routes LIMIT 1').first();
    if (existing || routes) throw new Error('EXISTING_ROUTES_REQUIRE_ADMIN_REVIEW');
    const url = new URL(env.UPSTREAM_BASE_URL);
    if (url.origin !== 'https://www.lvzhouai.cc' || url.pathname.replace(/\/$/,'') !== '/v1' || url.username || url.password || url.search || url.hash) throw new Error('UNEXPECTED_UPSTREAM');
    const key = String(env.UPSTREAM_API_KEY || '').trim();
    if (!key) throw new Error('MISSING_EXISTING_UPSTREAM_KEY');
    const encrypted = await encryptSecret(key, env);
    const id = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO upstream_profiles(id,name,base_url,api_key_ciphertext,api_key_iv,key_hint) VALUES(?,?,?,?,?,?)')
      .bind(id,'现有生产上游',url.toString().replace(/\/$/,''),encrypted.ciphertext,encrypted.iv,'已加密').run();
    await env.DB.batch(MODEL_SEEDS.map(m=>env.DB.prepare('INSERT OR IGNORE INTO model_catalog(id,name,upstream_id,price_json) VALUES(?,?,?,?)').bind(m.id,m.name,m.id,JSON.stringify(m.price))));
    const row = await env.DB.prepare('SELECT * FROM upstream_profiles WHERE id=?').bind(id).first();
    const outcomes = [];
    for (const model of MODEL_SEEDS) {
      const web = await probeProfile(env,row,'web_chat',model.id);
      const agent = await probeProfile(env,row,'desktop_codex',model.id);
      outcomes.push({id:model.id,web:web.ok,agent:agent.ok});
      await env.DB.prepare('UPDATE security_audit SET metadata=? WHERE id=?').bind(JSON.stringify({profileId:id,outcomes}),job).run();
    }
    if (!outcomes.find(m=>m.id==='gpt-5.6-sol' && m.web && m.agent)) throw new Error('DEFAULT_MODEL_FAILED_LIVE_PROBE');
    await env.DB.batch([
      ...['web_chat','desktop_codex'].map(channel=>env.DB.prepare('INSERT INTO upstream_routes(channel,profile_id,model_id) VALUES(?,?,?)').bind(channel,id,'gpt-5.6-sol')),
      ...outcomes.map(m=>env.DB.prepare('UPDATE model_catalog SET enabled=?,web_enabled=?,agent_enabled=? WHERE id=?').bind(m.web||m.agent?1:0,m.web?1:0,m.agent?1:0,m.id)),
      env.DB.prepare("UPDATE security_audit SET event='release_bootstrap_completed',metadata=? WHERE id=?").bind(JSON.stringify({profileId:id,outcomes}),job)
    ]);
  } catch (error) {
    // Only known local error codes are persisted. Never log upstream bodies or secrets.
    const code = /^[A-Z_]+$/.test(error?.message || '') ? error.message : 'BOOTSTRAP_FAILED';
    await env.DB.prepare("UPDATE security_audit SET event='release_bootstrap_failed',metadata=json_set(metadata,'$.error',?) WHERE id=?").bind(code,job).run();
    throw new Error(code);
  }
}

export default {
  fetch() { return Response.json({error:'服务更新中，请稍后重试。'},{status:503,headers:{'retry-after':'60','cache-control':'no-store'}}); },
  async scheduled(_event,env) { await bootstrap(env); }
};
