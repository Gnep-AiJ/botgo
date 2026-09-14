import { desktopCredentialFor, desktopRelayCredentialFor, issueDesktopKey } from './desktop-auth.js';
import { catalog, meteredProxy, normalizedUsage, usageObserver } from './metering.js';
import { resolveProfileConfig } from './platform-admin.js';

const reply = (data, status=200) => Response.json(data, {status, headers:{'cache-control':'no-store'}});
const bearer = request => request.headers.get('authorization')?.replace(/^Bearer\s+/i,'') || '';
const protocols = new Set(['chat','responses']);

export async function agentRoutes(env) {
  return (await env.DB.prepare(`SELECT r.*, m.name, m.upstream_id, m.price_json, m.multiplier_ppm,
    m.enabled AS model_enabled, m.agent_enabled, h.reason AS blocked_reason
    FROM agent_model_routes r JOIN model_catalog m ON m.id=r.model_id
    LEFT JOIN agent_route_health h ON h.model_id=r.model_id AND h.profile_id=r.profile_id AND h.protocol=r.protocol
    WHERE m.archived=0`).all()).results || [];
}

export function availableAgentRoutes(routes) {
  return routes.filter(r=>r.enabled && r.model_enabled && r.agent_enabled && r.verified_at && !r.blocked_reason);
}

export async function handleOpenCode(request, env, ctx, path) {
  if (!path.startsWith('/opencode/') && !path.startsWith('/desktop/opencode/')) return null;
  try {
    if (path==='/desktop/opencode/session' && request.method==='POST') {
      const identity=await desktopCredentialFor(env,bearer(request));
      const rows=availableAgentRoutes(await agentRoutes(env));
      if (!rows.length) return reply({error:'尚无通过验证的 Agent 模型。'},503);
      const issued=await issueDesktopKey(env,bearer(request));
      await env.DB.prepare("UPDATE api_keys SET expires_at=datetime('now','+1 day') WHERE id=?").bind(issued.keyId).run();
      const {settings}=await catalog(env);
      const models=rows.map(r=>({id:r.model_id,name:r.name,protocol:r.protocol,price:JSON.parse(r.price_json),
        multiplier:(r.multiplier_ppm??settings.multiplier_ppm)/1e6,usdCny:settings.usd_cny_ppm/1e6}));
      return reply({key:issued.key,models,defaultModel:models.some(m=>m.id===settings.default_model)?settings.default_model:models[0].id,
        account:{email:identity.account.email,balanceMicros:identity.account.credit_balance*10000+identity.account.credit_remainder_micros}},201);
    }
    const identity=await desktopRelayCredentialFor(env,bearer(request));
    if (!identity) return reply({error:'设备凭据无效或已撤销。'},401);
    if (path==='/opencode/v1/models' && request.method==='GET') {
      return reply({object:'list',data:availableAgentRoutes(await agentRoutes(env)).map(r=>({id:r.model_id,object:'model',owned_by:'botgo'}))});
    }
    if (path==='/opencode/usage' && request.method==='GET') {
      const taskId=new URL(request.url).searchParams.get('taskId');
      if (!taskId || !/^[A-Za-z0-9_-]{1,128}$/.test(taskId)) return reply({error:'任务标识无效。'},400);
      const rows=await env.DB.prepare(`SELECT id,model,state,charged_micros,usage_json FROM metered_requests
        WHERE account_id=? AND channel='desktop_opencode' AND json_extract(snapshot,'$.taskId')=? ORDER BY created_at`).bind(identity.account_id,taskId).all();
      return reply({taskId,requests:rows.results||[],chargedMicros:(rows.results||[]).reduce((n,r)=>n+r.charged_micros,0)});
    }
    const protocol=path==='/opencode/v1/chat/completions'?'chat':path==='/opencode/v1/responses'?'responses':null;
    if (!protocol || request.method!=='POST') return reply({error:'接口不存在。'},404);
    // Bound request memory before JSON parsing, including requests without Content-Length.
    const reader=request.body?.getReader(); if(!reader)return reply({error:'请求为空。'},400);
    const chunks=[];let length=0;
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1000000){await reader.cancel();return reply({error:'请求过大。'},413);}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    let body;try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{return reply({error:'JSON 无效。'},400);}
    if(!body||typeof body.model!=='string'||(protocol==='chat'?!Array.isArray(body.messages):body.input===undefined))return reply({error:'请求不完整。'},400);
    if(identity.model && identity.model!==body.model)return reply({error:'凭据不允许访问该模型。'},403);
    const route=availableAgentRoutes(await agentRoutes(env)).find(r=>r.model_id===body.model && r.protocol===protocol);
    if(!route)return reply({error:'模型或协议未启用，或上游用量需要核对。'},503);
    const upstream=await resolveProfileConfig(env,route.profile_id);
    if(!upstream)return reply({error:'上游配置不可用。'},503);
    const taskId=request.headers.get('x-botgo-task-id');
    if(taskId && !/^[A-Za-z0-9_-]{1,128}$/.test(taskId))return reply({error:'任务标识无效。'},400);
    return await meteredProxy(request,env,ctx,{accountId:identity.account_id,channel:'desktop_opencode',body,upstream,
      agentRoute:route,taskId:taskId||null});
  } catch(error) {
    if(error?.status)return reply({error:error.message},error.status);
    return reply({error:'Agent 服务暂不可用。'},503);
  }
}

async function readProbe(response) {
  if(!response.ok){await response.body?.cancel();throw Error(`HTTP_${response.status}`);}
  const reader=response.body.getReader(),chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw Error('PROBE_SIZE');}chunks.push(value);}
  const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
  const text=new TextDecoder().decode(bytes);
  if(!response.headers.get('content-type')?.includes('text/event-stream'))throw Error('EXPECTED_SSE');
  const observer=usageObserver();observer.push(bytes);normalizedUsage(observer.finish());
  return text.split(/\r?\n/).filter(l=>l.startsWith('data:') && l.slice(5).trim()!=='[DONE]').map(l=>JSON.parse(l.slice(5)));
}

export async function probeAgentRoute(env, route, upstreamId) {
  const upstream=await resolveProfileConfig(env,route.profile_id);
  if(!upstream)throw Error('NO_PROFILE');
  const chat=route.protocol==='chat';
  const fn={name:'botgo_probe',description:'Return a fixed probe value.',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},strict:true};
  const prompt={role:'user',content:'Call botgo_probe with value OK; then reply OK.'};
  const tools=chat?[{type:'function',function:fn}]:[{type:'function',...fn}];
  const invoke=body=>fetch(`${upstream.baseUrl}/${chat?'chat/completions':'responses'}`,{method:'POST',redirect:'manual',
    headers:{authorization:`Bearer ${upstream.apiKey}`,'content-type':'application/json'},signal:AbortSignal.timeout(45000),
    body:JSON.stringify({model:upstreamId,stream:true,...(chat?{max_completion_tokens:128,stream_options:{include_usage:true}}:{max_output_tokens:128}),...body})}).then(readProbe);
  const events=await invoke(chat?{messages:[prompt],tools,tool_choice:{type:'function',function:{name:fn.name}}}:{input:[prompt],tools,tool_choice:{type:'function',name:fn.name}});
  if(chat){
    const call={id:'',type:'function',function:{name:'',arguments:''}};
    for(const e of events)for(const c of e.choices?.[0]?.delta?.tool_calls||[]){if(c.index!==0)continue;call.id+=c.id||'';call.function.name+=c.function?.name||'';call.function.arguments+=c.function?.arguments||'';}
    if(!call.id||call.function.name!==fn.name)throw Error('MISSING_TOOL');
    JSON.parse(call.function.arguments);
    await invoke({messages:[prompt,{role:'assistant',content:null,tool_calls:[call]},{role:'tool',tool_call_id:call.id,content:'OK'}]});
  }else{
    const output=events.find(e=>e.type==='response.completed')?.response?.output||[];
    const call=output.find(e=>e.type==='function_call'&&e.name===fn.name);
    if(!call?.call_id)throw Error('MISSING_TOOL');
    await invoke({input:[prompt,...output,{type:'function_call_output',call_id:call.call_id,output:'OK'}]});
  }
}

export async function handleAgentAdmin(request,env,path,admin,audit) {
  if(!path.startsWith('/admin/opencode'))return null;
  if(path==='/admin/opencode' && request.method==='GET')return reply({routes:await agentRoutes(env)});
  const match=path.match(/^\/admin\/opencode\/models\/([A-Za-z0-9._-]{1,128})(\/probe)?$/);
  if(!match)return reply({error:'接口不存在。'},404);
  if(match[2] && request.method==='POST'){
    const route=(await agentRoutes(env)).find(r=>r.model_id===match[1]);
    if(!route)return reply({error:'请先保存路由。'},404);
    try{
      await probeAgentRoute(env,route,route.upstream_id);
      const changes=await env.DB.batch([
        env.DB.prepare("UPDATE agent_model_routes SET verified_at=CURRENT_TIMESTAMP WHERE model_id=? AND revision=?").bind(route.model_id,route.revision),
        env.DB.prepare('DELETE FROM agent_route_health WHERE model_id=? AND profile_id=? AND protocol=? AND EXISTS(SELECT 1 FROM agent_model_routes WHERE model_id=? AND revision=? AND verified_at IS NOT NULL)').bind(route.model_id,route.profile_id,route.protocol,route.model_id,route.revision)
      ]);
      if(!changes[0].meta?.changes)return reply({error:'测试期间配置已变化，请重新测试。'},409);
      await audit(env,admin.id,'opencode_route_verified',{model:route.model_id,revision:route.revision});return reply({ok:true});
    }catch{
      await env.DB.prepare('UPDATE agent_model_routes SET verified_at=NULL,enabled=0 WHERE model_id=? AND revision=?').bind(route.model_id,route.revision).run();
      await audit(env,admin.id,'opencode_route_probe_failed',{model:route.model_id});return reply({error:'流式工具调用、续接或 usage 验证失败。'},502);
    }
  }
  if(request.method!=='PUT')return reply({error:'方法不支持。'},405);
  const body=await request.json().catch(()=>null);
  if(!body||!protocols.has(body.protocol)||typeof body.enabled!=='boolean')return reply({error:'路由配置无效。'},400);
  const model=await env.DB.prepare('SELECT id FROM model_catalog WHERE id=? AND archived=0').bind(match[1]).first();
  const profile=await env.DB.prepare('SELECT id FROM upstream_profiles WHERE id=?').bind(body.profileId).first();
  if(!model||!profile)return reply({error:'模型或上游不存在。'},400);
  const old=(await agentRoutes(env)).find(r=>r.model_id===match[1]);
  const unchanged=old?.profile_id===body.profileId && old?.protocol===body.protocol;
  if(body.enabled&&(!unchanged||!old.verified_at||old.blocked_reason))return reply({error:'请保存禁用配置，通过探测后再启用。'},409);
  const cost=body.costPrice||null;
  if(cost&&!['input','cached','write','output'].every(k=>Number.isFinite(cost[k])&&cost[k]>=0&&cost[k]<=10000000))return reply({error:'成本单价无效，单位为美元/百万 token。'},400);
  await env.DB.prepare(`INSERT INTO agent_model_routes(model_id,profile_id,protocol,enabled,cost_price_json) VALUES(?,?,?,?,?)
    ON CONFLICT(model_id) DO UPDATE SET profile_id=excluded.profile_id,protocol=excluded.protocol,enabled=excluded.enabled,
    verified_at=CASE WHEN agent_model_routes.profile_id=excluded.profile_id AND agent_model_routes.protocol=excluded.protocol THEN verified_at ELSE NULL END,
    cost_price_json=excluded.cost_price_json,revision=revision+1,updated_at=CURRENT_TIMESTAMP`).bind(match[1],body.profileId,body.protocol,body.enabled?1:0,cost?JSON.stringify(cost):null).run();
  await audit(env,admin.id,'opencode_route_changed',{model:match[1],profileId:body.profileId,protocol:body.protocol,enabled:body.enabled});
  return reply({ok:true});
}
