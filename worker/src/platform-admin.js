import { grantBalance } from "./account-operations.js";
import { handleAlipayRoute } from "./alipay-routes.js";
import { desktopCredentialFor } from './desktop-auth.js';
import { handleMeteringAdmin, usageObserver } from "./metering.js";
import { handleAgentAdmin } from './opencode-gateway.js';

const encoder = new TextEncoder();
const CHANNELS = new Set(["web_chat", "desktop_codex"]);
const CREDIT_SCALE = 100;

function balanceYuan(value) {
  const cents = Number(value);
  return Number.isFinite(cents) ? Math.round(cents) / CREDIT_SCALE : 0;
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeBase64url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function bodyOf(request) { try { return await request.json(); } catch { return null; } }

function validUpstreamUrl(value, ownHost = "") {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const blocked = host === "localhost" || host === ownHost.toLowerCase() || host === "0.0.0.0" || host === "::1" || host.endsWith(".local") || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || blocked) return null;
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}

async function encryptionKey(env) {
  if (typeof env.UPSTREAM_CONFIG_KEY !== "string") return null;
  try {
    const bytes = decodeBase64url(env.UPSTREAM_CONFIG_KEY.trim());
    if (bytes.byteLength !== 32) return null;
    return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch { return null; }
}

export async function encryptSecret(value, env) {
  const key = await encryptionKey(env);
  if (!key) throw new Error("UPSTREAM_CONFIG_KEY must be a base64url encoded 32-byte Worker Secret");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(value));
  return { ciphertext: base64url(new Uint8Array(ciphertext)), iv: base64url(iv) };
}

async function decryptSecret(ciphertext, iv, env) {
  const key = await encryptionKey(env);
  if (!key) throw new Error("missing upstream encryption key");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64url(iv) }, key, decodeBase64url(ciphertext));
  return new TextDecoder().decode(plaintext);
}

export async function resolveProfileConfig(env, profileId) {
  const row=await env.DB.prepare('SELECT id,base_url,api_key_ciphertext,api_key_iv FROM upstream_profiles WHERE id=?').bind(profileId).first();
  return row?{baseUrl:row.base_url,apiKey:await decryptSecret(row.api_key_ciphertext,row.api_key_iv,env),profileId:row.id}:null;
}

export async function resolveUpstreamConfig(env, channel = "web_chat") {
  if (!CHANNELS.has(channel)) return null;
  const routed = await env.DB.prepare("SELECT p.base_url, p.api_key_ciphertext, p.api_key_iv, r.model_id, p.id AS profile_id FROM upstream_routes r JOIN upstream_profiles p ON p.id = r.profile_id WHERE r.channel = ? LIMIT 1").bind(channel).first();
  if (routed) return { baseUrl: routed.base_url, apiKey: await decryptSecret(routed.api_key_ciphertext, routed.api_key_iv, env), modelId: routed.model_id, profileId: routed.profile_id };
  const legacy = await env.DB.prepare("SELECT id, base_url, api_key_ciphertext, api_key_iv FROM upstream_profiles WHERE status = 'active' LIMIT 1").first();
  if (legacy) return { baseUrl: legacy.base_url, apiKey: await decryptSecret(legacy.api_key_ciphertext, legacy.api_key_iv, env), modelId: "gpt-5.6", profileId: legacy.id };
  const baseUrl = typeof env.UPSTREAM_BASE_URL === "string" ? env.UPSTREAM_BASE_URL.trim().replace(/\/$/, "") : "";
  const apiKey = typeof env.UPSTREAM_API_KEY === "string" ? env.UPSTREAM_API_KEY.trim() : "";
  return baseUrl && apiKey ? { baseUrl, apiKey, modelId: "gpt-5.6", profileId: null } : null;
}

function classifyFailure(status) {
  if (status === 401 || status === 403) return "authentication_failed";
  if (status === 404 || status === 405) return "endpoint_unsupported";
  if (status === 408 || status === 504) return "timeout";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "upstream_unavailable";
  return status ? "request_rejected" : "network_error";
}

async function fetchWithTimeout(url, options, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, redirect: "manual" });
    return { response, latencyMs: Date.now() - started };
  } finally { clearTimeout(timeout); }
}

export async function probeProfile(env, row, channel, modelId) {
  const apiKey = await decryptSecret(row.api_key_ciphertext, row.api_key_iv, env);
  const headers = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
  let models = { ok: false, status: 0, latencyMs: 0, errorCode: "network_error" };
  try {
    const result = await fetchWithTimeout(`${row.base_url}/models`, { headers: { authorization: headers.authorization } });
    models = { ok: result.response.ok, status: result.response.status, latencyMs: result.latencyMs, errorCode: result.response.ok ? null : classifyFailure(result.response.status) };
  } catch (error) { models.errorCode = error?.name === "AbortError" ? "timeout" : "network_error"; }

  const endpoint = channel === "web_chat" ? "chat/completions" : "responses";
  const payload = channel === "web_chat"
    ? { model: modelId, messages: [{ role: "user", content: "Reply OK" }], max_completion_tokens: 32, stream: true, stream_options:{include_usage:true} }
    : { model: modelId, input: "Call botgo_probe with value OK.", max_output_tokens: 128, stream: true, tools:[{type:'function',name:'botgo_probe',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},strict:true}],tool_choice:{type:'function',name:'botgo_probe'} };
  let capability = { ok: false, status: 0, latencyMs: 0, errorCode: "network_error" };
  try {
    const started=Date.now();
    const response = await fetch(`${row.base_url}/${endpoint}`, { method: "POST", headers, body: JSON.stringify(payload),signal:AbortSignal.timeout(45000),redirect:'manual' });
    capability = { ok:false, status:response.status,latencyMs:Date.now()-started,errorCode:classifyFailure(response.status) };
    if(response.ok&&response.headers.get('content-type')?.includes('text/event-stream')){
      const observer=usageObserver(),reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw new Error('probe_too_large');}observer.push(value);text+=decoder.decode(value,{stream:true});}
      const usage=observer.finish();
      capability.ok=!!usage;
      capability.errorCode=usage?null:'missing_usage';
      if(channel==='desktop_codex'&&usage){
        const completed=text.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>{try{return JSON.parse(l.slice(5));}catch{return null;}}).find(e=>e?.type==='response.completed');
        const output=completed?.response?.output||[];
        const call=output.find(i=>i.type==='function_call'&&i.name==='botgo_probe');
        if(!call?.call_id){capability.ok=false;capability.errorCode='missing_tool_call';}
        else{
          const resumed=await fetch(`${row.base_url}/responses`,{method:'POST',headers,signal:AbortSignal.timeout(45000),redirect:'manual',body:JSON.stringify({model:modelId,stream:true,max_output_tokens:32,input:[{role:'user',content:'Call botgo_probe with value OK.'},...output,{type:'function_call_output',call_id:call.call_id,output:'OK'}],tools:payload.tools})});
          if(!resumed.ok||!resumed.headers.get('content-type')?.includes('text/event-stream')){await resumed.body?.cancel();capability.ok=false;capability.errorCode='tool_resume_failed';}
          else{const meter=usageObserver(),r=resumed.body.getReader();let bytes=0;for(;;){const {done,value}=await r.read();if(done)break;bytes+=value.length;if(bytes>1024*1024){await r.cancel();throw new Error('probe_too_large');}meter.push(value);}if(!meter.finish()){capability.ok=false;capability.errorCode='resume_missing_usage';}}
        }
      }
      capability.latencyMs=Date.now()-started;
    }else await response.body?.cancel();
  } catch (error) { capability.errorCode = ['AbortError','TimeoutError'].includes(error?.name) ? "timeout" : /redirect/i.test(error?.message||'') ? 'redirect_error' : error?.name==='TypeError' ? 'request_type_error' : "network_error"; }

  await env.DB.prepare("INSERT INTO upstream_route_probes (profile_id, channel, model_id, status, http_status, latency_ms, error_code, tested_at, metering_verified) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 1) ON CONFLICT(profile_id, channel, model_id) DO UPDATE SET status = excluded.status, http_status = excluded.http_status, latency_ms = excluded.latency_ms, error_code = excluded.error_code, tested_at = CURRENT_TIMESTAMP, metering_verified=1")
    .bind(row.id, channel, modelId, capability.ok ? "ok" : "failed", capability.status, capability.latencyMs, capability.errorCode).run();
  await env.DB.prepare("UPDATE upstream_profiles SET last_tested_at = CURRENT_TIMESTAMP, last_test_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(capability.ok ? "ok" : "failed", row.id).run();
  return { ok: capability.ok, models, capability };
}

function publicProfile(row, routeMap = new Map()) {
  return { id: row.id, name: row.name, baseUrl: row.base_url, keyHint: row.key_hint, lastTestedAt: row.last_tested_at, lastTestStatus: row.last_test_status, updatedAt: row.updated_at, assignedChannels: routeMap.get(row.id) || [] };
}

async function listRoutes(env) {
  const rows = await env.DB.prepare("SELECT r.channel, r.profile_id, r.model_id, r.updated_at, p.name AS profile_name, p.base_url FROM upstream_routes r JOIN upstream_profiles p ON p.id = r.profile_id ORDER BY r.channel").all();
  const history = await env.DB.prepare("SELECT h.channel, h.from_profile_id, h.from_model_id, h.created_at, p.name AS from_profile_name FROM upstream_route_history h LEFT JOIN upstream_profiles p ON p.id = h.from_profile_id WHERE h.id IN (SELECT id FROM upstream_route_history h2 WHERE h2.channel = h.channel ORDER BY h2.created_at DESC LIMIT 1)").all();
  const previous = Object.fromEntries((history.results || []).map((row) => [row.channel, { profileId: row.from_profile_id, profileName: row.from_profile_name, modelId: row.from_model_id, switchedAt: row.created_at }]));
  return (rows.results || []).map((row) => ({ channel: row.channel, profileId: row.profile_id, profileName: row.profile_name, baseUrl: row.base_url, modelId: row.model_id, updatedAt: row.updated_at, previous: previous[row.channel] || null }));
}

async function upstreamRoutes(request, env, path, admin, audit) {
  if (path === "/admin/routes" && request.method === "GET") return json({ routes: await listRoutes(env) });
  const routeMatch = path.match(/^\/admin\/routes\/(web_chat|desktop_codex)(?:\/(rollback))?$/);
  if (routeMatch && request.method === "PUT" && !routeMatch[2]) {
    const channel = routeMatch[1]; const body = await bodyOf(request);
    const profileId = String(body?.profileId || ""); const modelId = String(body?.modelId || "").trim().slice(0, 128);
    const profile = await env.DB.prepare("SELECT id FROM upstream_profiles WHERE id = ?").bind(profileId).first();
    const probe = await env.DB.prepare("SELECT status, tested_at FROM upstream_route_probes WHERE profile_id = ? AND channel = ? AND model_id = ?").bind(profileId, channel, modelId).first();
    const testedAt = Date.parse(`${String(probe?.tested_at || "").replace(" ", "T")}Z`);
    if (!profile || !modelId) return json({ error: "路由配置不完整。" }, 400);
    if (probe?.status !== "ok" || !Number.isFinite(testedAt) || Date.now() - testedAt > 10 * 60 * 1000) return json({ error: "必须先通过最近 10 分钟内的对应能力测试。" }, 409);
    const current = await env.DB.prepare("SELECT profile_id, model_id FROM upstream_routes WHERE channel = ?").bind(channel).first();
    const historyId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO upstream_route_history (id, channel, from_profile_id, from_model_id, to_profile_id, to_model_id, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(historyId, channel, current?.profile_id || null, current?.model_id || null, profileId, modelId, admin.id),
      env.DB.prepare("INSERT INTO upstream_routes (channel, profile_id, model_id, updated_by, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(channel) DO UPDATE SET profile_id = excluded.profile_id, model_id = excluded.model_id, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP").bind(channel, profileId, modelId, admin.id)
    ]);
    await audit(env, admin.id, "upstream_route_changed", { channel, profileId, modelId, previousProfileId: current?.profile_id || null });
    return json({ ok: true });
  }
  if (routeMatch && request.method === "POST" && routeMatch[2] === "rollback") {
    const channel = routeMatch[1];
    const previous = await env.DB.prepare("SELECT from_profile_id, from_model_id FROM upstream_route_history WHERE channel = ? AND from_profile_id IS NOT NULL ORDER BY created_at DESC LIMIT 1").bind(channel).first();
    if (!previous) return json({ error: "没有可回滚的历史路由。" }, 409);
    const probe = await env.DB.prepare("SELECT status, tested_at FROM upstream_route_probes WHERE profile_id = ? AND channel = ? AND model_id = ?").bind(previous.from_profile_id, channel, previous.from_model_id).first();
    const testedAt = Date.parse(`${String(probe?.tested_at || "").replace(" ", "T")}Z`);
    if (probe?.status !== "ok" || !Number.isFinite(testedAt) || Date.now() - testedAt > 10 * 60 * 1000) return json({ error: "原路由需要重新测试后才能回滚。" }, 409);
    const current = await env.DB.prepare("SELECT profile_id, model_id FROM upstream_routes WHERE channel = ?").bind(channel).first();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO upstream_route_history (id, channel, from_profile_id, from_model_id, to_profile_id, to_model_id, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), channel, current?.profile_id || null, current?.model_id || null, previous.from_profile_id, previous.from_model_id, admin.id),
      env.DB.prepare("UPDATE upstream_routes SET profile_id = ?, model_id = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE channel = ?").bind(previous.from_profile_id, previous.from_model_id, admin.id, channel)
    ]);
    await audit(env, admin.id, "upstream_route_rolled_back", { channel, profileId: previous.from_profile_id, modelId: previous.from_model_id });
    return json({ ok: true });
  }
  if (path === "/admin/upstreams" && request.method === "GET") {
    const [profiles, routes, probes] = await Promise.all([
      env.DB.prepare("SELECT id, name, base_url, key_hint, last_tested_at, last_test_status, updated_at FROM upstream_profiles ORDER BY updated_at DESC").all(),
      env.DB.prepare("SELECT channel, profile_id FROM upstream_routes").all(),
      env.DB.prepare("SELECT profile_id, channel, model_id, status, http_status, latency_ms, error_code, tested_at FROM upstream_route_probes ORDER BY tested_at DESC").all()
    ]);
    const routeMap = new Map();
    for (const route of routes.results || []) routeMap.set(route.profile_id, [...(routeMap.get(route.profile_id) || []), route.channel]);
    return json({ upstreams: (profiles.results || []).map((row) => ({ ...publicProfile(row, routeMap), probes: (probes.results || []).filter((probe) => probe.profile_id === row.id) })), fallbackConfigured: Boolean(env.UPSTREAM_BASE_URL && env.UPSTREAM_API_KEY) });
  }
  if (path === "/admin/upstreams/import-fallback" && request.method === "POST") {
    const baseUrl = validUpstreamUrl(env.UPSTREAM_BASE_URL, new URL(request.url).hostname); const apiKey = String(env.UPSTREAM_API_KEY || "").trim();
    if (!baseUrl || !apiKey) return json({ error: "当前 Worker 没有可导入的回退上游。" }, 409);
    const existing = await env.DB.prepare("SELECT id FROM upstream_profiles WHERE base_url = ? LIMIT 1").bind(baseUrl).first();
    if (existing) return json({ error: "该地址已经存在于上游列表。", profileId: existing.id }, 409);
    const encrypted = await encryptSecret(apiKey, env); const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO upstream_profiles (id, name, base_url, api_key_ciphertext, api_key_iv, key_hint) VALUES (?, ?, ?, ?, ?, ?)").bind(id, "当前 Worker 上游", baseUrl, encrypted.ciphertext, encrypted.iv, `••••${apiKey.slice(-4)}`).run();
    await audit(env, admin.id, "upstream_fallback_imported", { profileId: id, baseUrl });
    return json({ id }, 201);
  }
  if (path === "/admin/upstreams" && request.method === "POST") {
    const body = await bodyOf(request); const name = typeof body?.name === "string" ? body.name.trim().slice(0, 64) : ""; const baseUrl = validUpstreamUrl(body?.baseUrl, new URL(request.url).hostname); const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    if (!name || !baseUrl || apiKey.length < 8 || apiKey.length > 4096) return json({ error: "请填写有效名称、HTTPS 上游地址和 API Key。" }, 400);
    const encrypted = await encryptSecret(apiKey, env); const id = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO upstream_profiles (id, name, base_url, api_key_ciphertext, api_key_iv, key_hint) VALUES (?, ?, ?, ?, ?, ?)").bind(id, name, baseUrl, encrypted.ciphertext, encrypted.iv, `••••${apiKey.slice(-4)}`).run();
    await audit(env, admin.id, "upstream_created", { profileId: id, name }); return json({ upstream: { id, name, baseUrl, keyHint: `••••${apiKey.slice(-4)}` } }, 201);
  }
  const match = path.match(/^\/admin\/upstreams\/([0-9a-f-]+)(?:\/(test))?$/i);
  if (!match) return null;
  const row = await env.DB.prepare("SELECT * FROM upstream_profiles WHERE id = ?").bind(match[1]).first();
  if (!row) return json({ error: "上游配置不存在。" }, 404);
  if (request.method === "POST" && match[2] === "test") {
    const body = await bodyOf(request); const channel = String(body?.channel || ""); const modelId = String(body?.modelId || "").trim().slice(0, 128);
    if (!CHANNELS.has(channel) || !modelId) return json({ error: "请选择测试渠道并填写模型。" }, 400);
    const result = await probeProfile(env, row, channel, modelId); await audit(env, admin.id, "upstream_tested", { profileId: row.id, channel, modelId, ok: result.ok, status: result.capability.status });
    return json(result, result.ok ? 200 : 502);
  }
  if (request.method === "DELETE" && !match[2]) {
    const agentUsed=await env.DB.prepare('SELECT model_id FROM agent_model_routes WHERE profile_id=? LIMIT 1').bind(row.id).first();
    if(agentUsed)return json({error:'该上游仍被 OpenCode 路由引用，请先更换路由。'},409);
    const used = await env.DB.prepare("SELECT channel FROM upstream_routes WHERE profile_id = ? LIMIT 1").bind(row.id).first();
    if (used) return json({ error: "该上游正在被路由使用，不能删除。" }, 409);
    const historical = await env.DB.prepare("SELECT id FROM upstream_route_history WHERE from_profile_id = ? OR to_profile_id = ? LIMIT 1").bind(row.id, row.id).first();
    if (historical) return json({ error: "该上游存在路由历史，为保留审计记录不能删除。" }, 409);
    await env.DB.batch([env.DB.prepare("DELETE FROM upstream_route_probes WHERE profile_id = ?").bind(row.id), env.DB.prepare("DELETE FROM upstream_profiles WHERE id = ?").bind(row.id)]); await audit(env, admin.id, "upstream_deleted", { profileId: row.id }); return json({ ok: true });
  }
  if (request.method === "PUT" && !match[2]) {
    const agentUsed=await env.DB.prepare('SELECT model_id FROM agent_model_routes WHERE profile_id=? AND enabled=1 LIMIT 1').bind(row.id).first();
    if(agentUsed)return json({error:'请先禁用该上游的 OpenCode 路由再编辑。'},409);
    const used = await env.DB.prepare("SELECT channel FROM upstream_routes WHERE profile_id = ? LIMIT 1").bind(row.id).first();
    if (used) return json({ error: "该上游正在被路由使用，请先切换对应渠道后再编辑。" }, 409);
    const body = await bodyOf(request); const name = typeof body?.name === "string" ? body.name.trim().slice(0, 64) : row.name; const baseUrl = body?.baseUrl ? validUpstreamUrl(body.baseUrl, new URL(request.url).hostname) : row.base_url; const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    if (!name || !baseUrl || (apiKey && (apiKey.length < 8 || apiKey.length > 4096))) return json({ error: "上游配置不正确。" }, 400);
    let ciphertext = row.api_key_ciphertext; let iv = row.api_key_iv; let hint = row.key_hint;
    if (apiKey) { const encrypted = await encryptSecret(apiKey, env); ciphertext = encrypted.ciphertext; iv = encrypted.iv; hint = `••••${apiKey.slice(-4)}`; }
    await env.DB.batch([
      env.DB.prepare("UPDATE upstream_profiles SET name = ?, base_url = ?, api_key_ciphertext = ?, api_key_iv = ?, key_hint = ?, last_tested_at = NULL, last_test_status = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(name, baseUrl, ciphertext, iv, hint, row.id),
      env.DB.prepare("DELETE FROM upstream_route_probes WHERE profile_id = ?").bind(row.id)
    ]);
    await audit(env, admin.id, "upstream_updated", { profileId: row.id }); return json({ ok: true });
  }
  return json({ error: "接口不存在。" }, 404);
}

async function billingAdminRoutes(request, env, path, admin, audit) {
  if (path === "/admin/billing/plan" && request.method === "PUT") {
    const body = await bodyOf(request); const price = Number(body?.priceCents); const credits = Number(body?.includedCredits);
    if (!Number.isInteger(price) || price < 1 || price > 100000000 || !Number.isInteger(credits) || credits < 1 || credits > 100000000) return json({ error: "价格或额度不正确。" }, 400);
    await env.DB.prepare("UPDATE billing_settings SET price_cents = ?, included_credits = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'pro'").bind(price, credits).run(); await audit(env, admin.id, "billing_plan_updated", { priceCents: price, includedCredits: credits }); return json({ ok: true });
  }
  const balanceGrant = path.match(/^\/admin\/accounts\/([^/]+)\/grants$/);
  if(balanceGrant && request.method === "POST") return grantBalance(request,env,admin,decodeURIComponent(balanceGrant[1]));
  const grant = path.match(/^\/admin\/accounts\/([^/]+)\/subscription$/);
  if (grant && request.method === "POST") return json({error:"套餐已停用，请使用赠送余额。"},410);
  return null;
}

async function operationsRoutes(request, env, path) {
  if (path === "/admin/accounts" && request.method === "GET") {
    const url = new URL(request.url); const query = `%${(url.searchParams.get("query") || "").trim().slice(0, 100)}%`; const status = url.searchParams.get("status") || "all"; const page = Math.max(1, Number(url.searchParams.get("page")) || 1); const limit = 25; const offset = (page - 1) * limit;
    const where = status === "active" || status === "suspended" ? "WHERE a.email LIKE ? AND a.status = ?" : "WHERE a.email LIKE ?"; const bindings = status === "active" || status === "suspended" ? [query, status] : [query];
    const rows = await env.DB.prepare(`SELECT a.id, a.email, a.role, a.status, a.credit_balance, a.created_at, s.plan, s.expires_at FROM accounts a LEFT JOIN subscriptions s ON s.account_id = a.id ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`).bind(...bindings, limit, offset).all();
    const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM accounts a ${where}`).bind(...bindings).first(); return json({ accounts: (rows.results || []).map((row) => ({ ...row, credit_balance: balanceYuan(row.credit_balance), credit_balance_cents: Number(row.credit_balance) || 0 })), page, pages: Math.max(1, Math.ceil(Number(total?.count || 0) / limit)), total: Number(total?.count || 0) });
  }
  if (path === "/admin/audit" && request.method === "GET") {
    const url = new URL(request.url); const event = (url.searchParams.get("event") || "").trim().slice(0, 80); const page = Math.max(1, Number(url.searchParams.get("page")) || 1); const limit = 40; const offset = (page - 1) * limit;
    const rows = event ? await env.DB.prepare("SELECT s.id, s.event, s.metadata, s.created_at, a.email FROM security_audit s LEFT JOIN accounts a ON a.id = s.account_id WHERE s.event LIKE ? ORDER BY s.created_at DESC LIMIT ? OFFSET ?").bind(`%${event}%`, limit, offset).all() : await env.DB.prepare("SELECT s.id, s.event, s.metadata, s.created_at, a.email FROM security_audit s LEFT JOIN accounts a ON a.id = s.account_id ORDER BY s.created_at DESC LIMIT ? OFFSET ?").bind(limit, offset).all();
    const audits = (rows.results || []).map((row) => { let metadata = {}; try { metadata = JSON.parse(row.metadata || "{}"); } catch {} for (const key of Object.keys(metadata)) if (/key|token|prompt|body|secret|cipher|emailHash|ipHash/i.test(key)) delete metadata[key]; return { id: row.id, event: row.event, actor: row.email || "系统", metadata, createdAt: row.created_at }; });
    return json({ audits, page });
  }
  return null;
}

async function releaseAdminRoutes(request, env, path, admin, audit) {
  if (path === "/admin/desktop/releases" && request.method === "GET") { const rows = await env.DB.prepare("SELECT * FROM desktop_releases ORDER BY created_at DESC LIMIT 50").all(); return json({ releases: rows.results || [], bucketConfigured: Boolean(env.DESKTOP_RELEASES) }); }
  if (path === "/admin/desktop/releases" && request.method === "POST") {
    const body = await bodyOf(request); const size = Number(body?.sizeBytes); if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(body?.version || "") || !/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,240}$/.test(body?.objectKey || "") || !/^[A-Fa-f0-9]{64}$/.test(body?.sha256 || "") || !Number.isInteger(size) || size < 1) return json({ error: "发布元数据不正确。" }, 400);
    const id = crypto.randomUUID(); const fileName = String(body.fileName || `BotGo-Setup-${body.version}.exe`).replace(/[\\/\r\n]/g, "").slice(0, 160); await env.DB.prepare("INSERT INTO desktop_releases (id, version, object_key, file_name, size_bytes, sha256, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, body.version, body.objectKey, fileName, size, body.sha256.toLowerCase(), String(body.notes || "").slice(0, 2000)).run(); await audit(env, admin.id, "desktop_release_created", { releaseId: id, version: body.version }); return json({ id }, 201);
  }
  const removal=path.match(/^\/admin\/desktop\/releases\/([0-9a-f-]+)$/i);
  if(removal && request.method==='DELETE') {
    const result=await env.DB.prepare("DELETE FROM desktop_releases WHERE id=? AND status='draft'").bind(removal[1]).run();
    if(!result.meta.changes)return json({error:'只能删除版本草稿。'},409);
    await audit(env,admin.id,'desktop_release_deleted',{releaseId:removal[1]});return json({ok:true});
  }
  const publish = path.match(/^\/admin\/desktop\/releases\/([0-9a-f-]+)\/publish$/i);
  if (publish && request.method === "POST") { const row = await env.DB.prepare("SELECT * FROM desktop_releases WHERE id = ?").bind(publish[1]).first(); if (!row) return json({ error: "发布记录不存在。" }, 404); if (!env.DESKTOP_RELEASES || !await env.DESKTOP_RELEASES.head(row.object_key)) return json({ error: "R2 中未找到对应安装包。" }, 409); await env.DB.batch([env.DB.prepare("UPDATE desktop_releases SET status = 'retired', updated_at = CURRENT_TIMESTAMP WHERE platform = ? AND status = 'published'").bind(row.platform), env.DB.prepare("UPDATE desktop_releases SET status = 'published', published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(row.id)]); await audit(env, admin.id, "desktop_release_published", { releaseId: row.id, version: row.version }); return json({ ok: true }); }
  return null;
}

async function signedDownloadToken(env, releaseId, accountId, expires) { const key = await crypto.subtle.importKey("raw", encoder.encode(env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${releaseId}.${accountId}.${expires}`)))); }

export async function handlePlatformRoute(request, env, path, helpers) {
  if (path.startsWith("/admin/")) {
    const admin = await helpers.activeAdminFor(request, env);
    if (!admin) return json({ error: "需要管理员权限。" }, 403);
    return await handleAgentAdmin(request, env, path, admin, helpers.audit)
      || await handleMeteringAdmin(request, env, path, admin, helpers.audit)
      || await upstreamRoutes(request, env, path, admin, helpers.audit)
      || await handleAlipayRoute(request, env, path, { ...helpers, admin })
      || await billingAdminRoutes(request, env, path, admin, helpers.audit)
      || await releaseAdminRoutes(request, env, path, admin, helpers.audit)
      || await operationsRoutes(request, env, path);
  }
  const alipayResponse = await handleAlipayRoute(request, env, path, helpers);
  if (alipayResponse) return alipayResponse;
  if (path === "/desktop/releases/current" && request.method === "GET") { let session = await helpers.sessionFor(request, env);
    if (!session && request.headers.get('authorization')?.startsWith('Bearer bgdt_')) {
      try { const credential = await desktopCredentialFor(env, request.headers.get('authorization').slice(7)); session = { sub: credential.account.id }; }
      catch (error) { return json({ error: error.message }, error.status || 401); }
    } if (!session) return json({ error: "请先登录。" }, 401); const row = await env.DB.prepare("SELECT id, version, file_name, size_bytes, sha256, notes, published_at FROM desktop_releases WHERE platform = 'win-x64' AND status = 'published' LIMIT 1").first(); if (!row) return json({ release: null }); const expires = Math.floor(Date.now() / 1000) + 300; const token = await signedDownloadToken(env, row.id, session.sub, expires); return json({ release: { ...row, downloadUrl: `/api/desktop/releases/${row.id}/download?account=${encodeURIComponent(session.sub)}&expires=${expires}&token=${token}` } }); }
  const download = path.match(/^\/desktop\/releases\/([0-9a-f-]+)\/download$/i);
  if (download && request.method === "GET") { const url = new URL(request.url); const account = url.searchParams.get("account") || ""; const expires = Number(url.searchParams.get("expires")); const token = url.searchParams.get("token") || ""; if (!account || !Number.isInteger(expires) || expires < Math.floor(Date.now() / 1000) || token !== await signedDownloadToken(env, download[1], account, expires)) return json({ error: "下载链接无效或已过期。" }, 403); const row = await env.DB.prepare("SELECT object_key, file_name FROM desktop_releases WHERE id = ? AND status = 'published'").bind(download[1]).first(); if (!row || !env.DESKTOP_RELEASES) return json({ error: "安装包不可用。" }, 404); const object = await env.DESKTOP_RELEASES.get(row.object_key); if (!object) return json({ error: "安装包不存在。" }, 404); const safeName = row.file_name.replace(/[^A-Za-z0-9._-]/g, "_") || "BotGo-Desktop.exe"; return new Response(object.body, { headers: { "content-type": "application/vnd.microsoft.portable-executable", "content-disposition": `attachment; filename="${safeName}"`, "content-length": String(object.size), "cache-control": "private, no-store", "x-content-type-options": "nosniff" } }); }
  return null;
}
