export const DIAGNOSTIC_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
const DAILY_LIMIT = 20;
const reply = (body, status = 200) => Response.json(body, {status, headers: {'cache-control':'no-store'}});
const count = value => Math.max(0, Math.min(1000000000, Number(value) || 0));
const label = value => /^[a-z_]{1,48}$/.test(value || '') ? value : 'other';

export async function diagnosticSnapshot(env) {
  const [requests, probes, health, models] = await Promise.all([
    env.DB.prepare(`SELECT state,review_reason,COUNT(*) AS count FROM metered_requests
      WHERE created_at>=datetime('now','-24 hours') GROUP BY state,review_reason ORDER BY count DESC LIMIT 20`).all(),
    env.DB.prepare(`SELECT status,http_status,COUNT(*) AS count,ROUND(AVG(latency_ms)) AS latency_ms
      FROM upstream_route_probes WHERE tested_at>=datetime('now','-24 hours')
      GROUP BY status,http_status ORDER BY count DESC LIMIT 10`).all(),
    env.DB.prepare('SELECT reason,COUNT(*) AS count FROM agent_route_health GROUP BY reason ORDER BY count DESC LIMIT 10').all(),
    env.DB.prepare(`SELECT COUNT(*) AS total,SUM(enabled) AS enabled FROM model_catalog WHERE archived=0`).first()
  ]);
  return {windowHours:24, requests:(requests.results || []).map(row=>({state:label(row.state),reason:label(row.review_reason),count:count(row.count)})),
    // These are last stored probe results, not all attempts or a live availability check.
    lastStoredProbes:(probes.results || []).map(row=>({status:label(row.status),httpStatus:count(row.http_status),count:count(row.count),averageLatencyMs:count(row.latency_ms)})),
    storedRouteFlags:(health.results || []).map(row=>({reason:label(row.reason),count:count(row.count)})),
    models:{total:count(models?.total),enabled:count(models?.enabled)}};
}

function validAdvice(raw) {
  const text = raw?.choices?.[0]?.message?.content ?? raw?.response;
  if (typeof text !== 'string' || text.length > 12000) throw Error('INVALID_AI_OUTPUT');
  const data = JSON.parse(text);
  const field = value => typeof value === 'string' && value.length > 0 && value.length <= 1200;
  if (!field(data.summary) || !['observations','possibleCauses','missingEvidence','nextChecks'].every(key=>
    Array.isArray(data[key]) && data[key].length <= 5 && data[key].every(field))) throw Error('INVALID_AI_OUTPUT');
  return Object.fromEntries(['summary','observations','possibleCauses','missingEvidence','nextChecks'].map(key=>[key,data[key]]));
}

export async function handleAdminAI(request, env, path, admin, audit) {
  if (path !== '/admin/ai-diagnostics') return null;
  if (!admin) return reply({error:'需要管理员权限。'},403);
  if (!['GET','POST'].includes(request.method)) return reply({error:'不支持的请求方法。'},405);
  if (request.method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin)
    return reply({error:'请求来源无效。'},403);
  const snapshot = await diagnosticSnapshot(env);
  const quota = await env.DB.prepare("SELECT COUNT(*) AS count FROM admin_ai_diagnostics WHERE created_at>=date('now')").first();
  const base = {snapshot,model:DIAGNOSTIC_MODEL,dailyLimit:DAILY_LIMIT,used:count(quota?.count),enabled:env.ADMIN_AI_ENABLED==='1' && !!env.AI};
  if (request.method === 'GET') return reply(base);
  if (!base.enabled) return reply({...base,error:'AI 分析尚未启用；原始统计仍可查看。'},503);
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  if (bytes.length > 6000) return reply({...base,error:'统计摘要过大。'},413);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  const cached = await env.DB.prepare(`SELECT result_json,finished_at FROM admin_ai_diagnostics
    WHERE snapshot_hash=? AND state='completed' AND created_at>=datetime('now','-1 hour') ORDER BY created_at DESC LIMIT 1`).bind(hash).first();
  if (cached) return reply({...base,advice:JSON.parse(cached.result_json),cached:true,analyzedAt:cached.finished_at});
  const id = crypto.randomUUID();
  // One atomic SQL statement prevents concurrent requests exceeding the allowance.
  // Failed/time-out attempts also consume allowance; never auto-retry inference.
  const reserved = await env.DB.prepare(`INSERT INTO admin_ai_diagnostics(id,snapshot_hash,state)
    SELECT ?,?,'running' WHERE
    (SELECT COUNT(*) FROM admin_ai_diagnostics WHERE created_at>=date('now'))<? AND
    NOT EXISTS(SELECT 1 FROM admin_ai_diagnostics WHERE state='running' AND created_at>=datetime('now','-2 minutes'))`)
    .bind(id,hash,DAILY_LIMIT).run();
  if (!reserved.meta?.changes) return reply({...base,error:'已有分析正在运行或今日分析次数已用完，请稍后再试。'},429);
  let timer;
  try {
    await audit(env,admin.id,'admin_ai_analysis_started',{id,model:DIAGNOSTIC_MODEL});
    const inference = env.AI.run(DIAGNOSTIC_MODEL, {messages:[
      {role:'system',content:'你是 BotGo 运维分析助手。仅根据统计给出中文建议，不执行操作。返回 JSON 对象，字段 summary(字符串), observations, possibleCauses, missingEvidence, nextChecks(各为最多5条字符串)。区分观察与推测，缺少证据时明确说明。lastStoredProbes 是最近24小时内更新的最后探测结果，不是全部尝试；storedRouteFlags 可能是历史标记。refunded 不等于上游失败，enabled 不等于可用。不能据此推断模型身份、实时可用性、单用户故障或账务错误。不要建议绕过鉴权、自动改价、自动扣费或自动切换路由。'},
      {role:'user',content:JSON.stringify(snapshot)}],max_tokens:2048,temperature:0.2,response_format:{type:'json_object'}});
    const raw = await Promise.race([inference,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('AI_TIMEOUT')),45000);})]);
    const advice = validAdvice(raw);
    await env.DB.prepare("UPDATE admin_ai_diagnostics SET state='completed',result_json=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(advice),id).run();
    await env.DB.prepare("DELETE FROM admin_ai_diagnostics WHERE created_at<datetime('now','-7 days')").run();
    return reply({...base,used:base.used+1,advice,cached:false,analyzedAt:new Date().toISOString()});
  } catch {
    await env.DB.prepare("UPDATE admin_ai_diagnostics SET state='failed',finished_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run();
    return reply({...base,used:base.used+1,error:'AI 分析未完成（可能超时、额度不足或返回格式无效）；请依据原始统计排查。'},503);
  } finally {clearTimeout(timer);}
}
