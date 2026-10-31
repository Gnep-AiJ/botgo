import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { randomUUID, webcrypto } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { normalizedUsage, usageObserver } from '../worker/src/metering.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wrangler = path.join(root, '.tmp-wrangler-config', 'cli', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const config = path.join(root, 'worker', 'wrangler.jsonc');
const secretFile = path.join(root, '.secrets', 'upstream_config_key.txt');
const modelId = process.argv[2] || 'gpt-5.6-terra';
const profileId = process.argv[3] || '';
const apply = process.argv.includes('--apply');

if (!/^[A-Za-z0-9._-]{1,128}$/.test(modelId)) throw new Error('Invalid model id.');
if (!/^[0-9a-f-]{36}$/i.test(profileId)) throw new Error('Pass your upstream profile id as the third argument. Do not commit a production profile id.');
if (!apply) throw new Error('Pass --apply to run the production probe and enable the route.');

function sql(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function runD1(command) {
  const result = spawnSync(process.execPath, [wrangler, 'd1', 'execute', 'botgo', '--remote', '--config', config, '--json', '--command', command], {
    cwd: root, encoding: 'utf8', env: { ...process.env, WRANGLER_LOG_PATH: path.join(root, 'artifacts', 'verification', 'opencode-production-config.log') }, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`D1 command failed (${result.status}).`);
  const start = result.stdout.indexOf('[');
  if (start < 0) throw new Error('D1 returned no JSON result.');
  return JSON.parse(result.stdout.slice(start));
}
function decode64(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  return Buffer.from(normalized + '='.repeat((4 - normalized.length % 4) % 4), 'base64');
}
async function decrypt(ciphertext, iv) {
  const encodedKey = (await readFile(secretFile, 'utf8')).trim();
  const keyBytes = decode64(encodedKey);
  if (keyBytes.length !== 32) throw new Error('Invalid upstream configuration key.');
  const key = await webcrypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt']);
  const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: decode64(iv) }, key, decode64(ciphertext));
  keyBytes.fill(0);
  return new TextDecoder().decode(plain);
}
async function readProbe(response) {
  if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP_${response.status}`); }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) { await response.body?.cancel(); throw new Error('EXPECTED_SSE'); }
  const reader = response.body.getReader(), chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length; if (size > 1024 * 1024) { await reader.cancel(); throw new Error('PROBE_SIZE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  const observer = usageObserver(); observer.push(bytes); normalizedUsage(observer.finish());
  return new TextDecoder().decode(bytes).split(/\r?\n/)
    .filter(line => line.startsWith('data:') && line.slice(5).trim() !== '[DONE]')
    .map(line => JSON.parse(line.slice(5)));
}
async function probe(baseUrl, apiKey, upstreamId) {
  const fn = { name: 'botgo_probe', description: 'Return a fixed probe value.', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }, strict: true };
  const prompt = { role: 'user', content: 'Call botgo_probe with value OK; then reply OK.' };
  const invoke = body => fetch(`${baseUrl.replace(/\/$/, '')}/responses`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(45000),
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: upstreamId, stream: true, max_output_tokens: 128, ...body }),
  }).then(readProbe);
  const first = await invoke({ input: [prompt], tools: [{ type: 'function', ...fn }], tool_choice: { type: 'function', name: fn.name } });
  const output = first.find(event => event.type === 'response.completed')?.response?.output || [];
  const call = output.find(item => item.type === 'function_call' && item.name === fn.name);
  if (!call?.call_id) throw new Error('MISSING_TOOL');
  JSON.parse(call.arguments || '{}');
  await invoke({ input: [prompt, ...output, { type: 'function_call_output', call_id: call.call_id, output: 'OK' }] });
}

const model = sql(modelId), profile = sql(profileId);
runD1(`INSERT INTO agent_model_routes(model_id,profile_id,protocol,enabled,cost_price_json) VALUES(${model},${profile},'responses',0,NULL) ON CONFLICT(model_id) DO UPDATE SET profile_id=excluded.profile_id,protocol='responses',enabled=0,verified_at=NULL,cost_price_json=NULL,revision=revision+1,updated_at=CURRENT_TIMESTAMP;`);
try {
  const queried = runD1(`SELECT p.base_url,p.api_key_ciphertext,p.api_key_iv,m.upstream_id FROM upstream_profiles p JOIN model_catalog m ON m.id=${model} WHERE p.id=${profile} AND m.enabled=1 AND m.agent_enabled=1 LIMIT 1;`);
  const row = queried[0]?.results?.[0];
  if (!row) throw new Error('No enabled Agent model/profile pair.');
  const apiKey = await decrypt(row.api_key_ciphertext, row.api_key_iv);
  await probe(row.base_url, apiKey, row.upstream_id);
  const auditId = randomUUID();
  const metadata = JSON.stringify({ model: modelId, profileId, protocol: 'responses', source: 'configure-opencode-production.mjs' });
  runD1(`UPDATE agent_model_routes SET enabled=1,verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE model_id=${model} AND profile_id=${profile} AND protocol='responses'; INSERT INTO security_audit(id,account_id,event,metadata) VALUES(${sql(auditId)},NULL,'opencode_route_verified_maintenance',${sql(metadata)});`);
  console.log(JSON.stringify({ ok: true, model: modelId, profileId, protocol: 'responses', probeRequests: 2, enabled: true }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, model: modelId, enabled: false, error: String(error?.message || error).slice(0, 120) }));
  process.exitCode = 1;
}
