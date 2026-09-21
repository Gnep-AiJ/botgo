import { desktopCredentialFor, desktopRelayCredentialFor, issueDesktopKey } from './desktop-auth.js';
import { catalog, meteredProxy, normalizedUsage, usageObserver } from './metering.js';
import { resolveProfileConfig } from './platform-admin.js';

const reply = (data, status=200) => Response.json(data.error?{code:'REQUEST_REJECTED',retryable:false,requestId:crypto.randomUUID(),...data}:data, {status, headers:{'cache-control':'no-store'}});
const bearer = request => request.headers.get('authorization')?.replace(/^Bearer\s+/i,'') || '';
const protocols = new Set(['chat','responses']);
const usableMember = member => Boolean(member.enabled&&member.verified_at&&(!member.blocked_reason||['abandoned','usage_review'].includes(member.blocked_reason)));

export async function agentRoutes(env) {
  const routes=(await env.DB.prepare(`SELECT r.*, m.name, m.upstream_id, m.price_json, m.multiplier_ppm,
    m.enabled AS model_enabled, m.agent_enabled, h.reason AS blocked_reason
    FROM agent_model_routes r JOIN model_catalog m ON m.id=r.model_id
    LEFT JOIN agent_route_health h ON h.model_id=r.model_id AND h.profile_id=r.profile_id AND h.protocol=r.protocol
    WHERE m.archived=0`).all()).results || [];
  const members=(await env.DB.prepare(`SELECT a.model_id,a.profile_id,a.upstream_model_id,a.enabled,a.verified_at,a.priority,a.revision,
    p.name AS profile_name,p.base_url,p.max_concurrency,p.retired_at,COUNT(l.id) AS active_requests,h.reason AS blocked_reason
    FROM agent_route_members a JOIN upstream_profiles p ON p.id=a.profile_id
    JOIN agent_model_routes r ON r.model_id=a.model_id
    LEFT JOIN upstream_leases l ON l.profile_id=a.profile_id AND l.state='active' AND l.expires_at>CURRENT_TIMESTAMP
    LEFT JOIN agent_route_health h ON h.model_id=a.model_id AND h.profile_id=a.profile_id AND h.protocol=r.protocol
    GROUP BY a.model_id,a.profile_id,a.upstream_model_id,a.enabled,a.verified_at,a.priority,a.revision,p.name,p.base_url,p.max_concurrency,p.retired_at,h.reason
    ORDER BY a.model_id,(COUNT(l.id)*1.0/p.max_concurrency),a.priority,a.profile_id`).all()).results||[];
  return routes.map(route=>{
    let routeMembers=members.filter(member=>member.model_id===route.model_id).map(member=>({...member,enabled:Boolean(member.enabled&&!member.retired_at),max_concurrency:Number(member.max_concurrency)||5,active_requests:Number(member.active_requests)||0}));
    if(!routeMembers.some(member=>member.profile_id===route.profile_id))routeMembers.unshift({model_id:route.model_id,profile_id:route.profile_id,enabled:1,verified_at:route.verified_at,priority:100,revision:route.revision,max_concurrency:5,active_requests:0,blocked_reason:route.blocked_reason||null});
    const primary=routeMembers.find(member=>member.profile_id===route.profile_id)||routeMembers[0];
    return {...route,...primary,enabled:route.enabled,profile_id:primary?.profile_id||route.profile_id,members:routeMembers};
  });
}

export function availableAgentRoutes(routes) {
  return routes.filter(r=>r.enabled && r.model_enabled && r.agent_enabled && r.members?.some(usableMember));
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
    if(!route)return reply({error:'模型或协议未启用，请检查模型配置。',code:'ROUTE_UNAVAILABLE'},503);
    const members=route.members.filter(usableMember)
      .sort((a,b)=>(a.active_requests/a.max_concurrency)-(b.active_requests/b.max_concurrency)||a.priority-b.priority);
    const candidates=(await Promise.all(members.map(async member=>{
      const upstream=await resolveProfileConfig(env,member.profile_id);
      return upstream?{...upstream,upstreamModelId:member.upstream_model_id||route.upstream_id,activeLeases:member.active_requests,maxConcurrency:member.max_concurrency}:null;
    }))).filter(Boolean);
    if(!candidates.length)return reply({error:'上游配置不可用。'},503);
    const taskId=request.headers.get('x-botgo-task-id');
    if(taskId && !/^[A-Za-z0-9_-]{1,128}$/.test(taskId))return reply({error:'任务标识无效。'},400);
    return await meteredProxy(request,env,ctx,{accountId:identity.account_id,channel:'desktop_opencode',body,candidates,
      agentRoute:route,taskId:taskId||null});
  } catch(error) {
    if(error?.status)return reply({error:error.message},error.status);
    return reply({error:'Agent 服务暂不可用。'},503);
  }
}

async function readProbe(response) {
  if(!response.ok){
    const reader=response.body?.getReader();let size=0,raw='';
    if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;raw+=new TextDecoder().decode(value.slice(0,Math.max(0,4096-(size-value.byteLength))));if(size>=4096){await reader.cancel();break;}}}catch{await reader.cancel().catch(()=>{});}
    const error=Error(`HTTP_${response.status}`);
    try{const body=JSON.parse(raw),code=body?.error?.code??body?.error?.type??body?.code;if(typeof code==='string'&&/^[A-Za-z0-9._-]{1,64}$/.test(code))error.upstreamCode=code;}catch{}
    throw error;
  }
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
    const body=await request.json().catch(()=>null),profileId=String(body?.profileId||route.profile_id||'');
    if(body?.protocol&&body.protocol!==route.protocol)return reply({error:'协议尚未保存，请先保存禁用草稿后再探测。',code:'STALE_DRAFT'},409);
    const member=route.members.find(item=>item.profile_id===profileId);
    if(!member)return reply({error:'路由成员不存在。'},404);
    try{
      await probeAgentRoute(env,{...route,profile_id:profileId},member.upstream_model_id||route.upstream_id);
      const changes=await env.DB.batch([
        env.DB.prepare("UPDATE agent_route_members SET verified_at=CURRENT_TIMESTAMP,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE model_id=? AND profile_id=? AND revision=?").bind(route.model_id,profileId,member.revision),
        env.DB.prepare("UPDATE agent_model_routes SET verified_at=CURRENT_TIMESTAMP WHERE model_id=?").bind(route.model_id),
        env.DB.prepare('DELETE FROM agent_route_health WHERE model_id=? AND profile_id=? AND protocol=?').bind(route.model_id,profileId,route.protocol)
      ]);
      if(!changes[0].meta?.changes)return reply({error:'测试期间配置已变化，请重新测试。'},409);
      await audit(env,admin.id,'opencode_route_member_verified',{model:route.model_id,profileId});return reply({ok:true});
    }catch(error){
      await env.DB.batch([
        env.DB.prepare('UPDATE agent_route_members SET verified_at=NULL WHERE model_id=? AND profile_id=?').bind(route.model_id,profileId),
        env.DB.prepare('UPDATE agent_model_routes SET verified_at=(SELECT MAX(verified_at) FROM agent_route_members WHERE model_id=?) WHERE model_id=?').bind(route.model_id,route.model_id)
      ]);
      const code=/^(HTTP_\d+|EXPECTED_SSE|MISSING_TOOL|PROBE_SIZE|MISSING_USAGE)$/.test(String(error?.message))?error.message:'PROBE_FAILED';
      await audit(env,admin.id,'opencode_route_probe_failed',{model:route.model_id,profileId,code});return reply({error:`原生能力探测失败（${code}）。`,code,stage:'tool_or_usage'},502);
    }
  }
  if(request.method!=='PUT')return reply({error:'方法不支持。'},405);
  const body=await request.json().catch(()=>null);
  if(!body||!protocols.has(body.protocol)||typeof body.enabled!=='boolean')return reply({error:'路由配置无效。'},400);
  const model=await env.DB.prepare('SELECT id FROM model_catalog WHERE id=? AND archived=0').bind(match[1]).first();
  const members=Array.isArray(body.members)?body.members.map(item=>({profileId:String(item?.profileId||''),upstreamModelId:String(item?.upstreamModelId||''),enabled:item?.enabled!==false,priority:Number.isInteger(item?.priority)?item.priority:100})):body.profileId?[{profileId:String(body.profileId),upstreamModelId:'',enabled:true,priority:100}]:[];
  if(!model||!members.length||members.length>50||new Set(members.map(item=>item.profileId)).size!==members.length||members.some(item=>item.upstreamModelId&&!/^[A-Za-z0-9._:/-]{1,128}$/.test(item.upstreamModelId)))return reply({error:'模型或上游成员无效。'},400);
  for(const member of members)if(!await env.DB.prepare('SELECT id FROM upstream_profiles WHERE id=? AND retired_at IS NULL').bind(member.profileId).first())return reply({error:'模型或上游不存在或已退役。'},400);
  const old=(await agentRoutes(env)).find(r=>r.model_id===match[1]);
  const unchangedProtocol=old?.protocol===body.protocol;
  const verifiedMember=unchangedProtocol&&members.some(member=>member.enabled&&old?.members?.some(existing=>existing.profile_id===member.profileId&&(!member.upstreamModelId||member.upstreamModelId===(existing.upstream_model_id||old.upstream_id))&&usableMember(existing)));
  if(body.enabled&&!verifiedMember)return reply({error:'请先保存禁用配置，并至少通过一个成员探测后再启用。'},409);
  const cost=body.costPrice||null;
  if(cost&&!['input','cached','write','output'].every(k=>Number.isFinite(cost[k])&&cost[k]>=0&&cost[k]<=10000000))return reply({error:'成本单价无效，单位为美元/百万 token。'},400);
  const primary=members.find(member=>member.enabled)||members[0];
  const statements=[env.DB.prepare(`INSERT INTO agent_model_routes(model_id,profile_id,protocol,enabled,cost_price_json) VALUES(?,?,?,?,?)
    ON CONFLICT(model_id) DO UPDATE SET profile_id=excluded.profile_id,protocol=excluded.protocol,enabled=excluded.enabled,
    verified_at=CASE WHEN ? THEN verified_at ELSE NULL END,
    cost_price_json=excluded.cost_price_json,revision=revision+1,updated_at=CURRENT_TIMESTAMP`).bind(match[1],primary.profileId,body.protocol,body.enabled?1:0,cost?JSON.stringify(cost):null,verifiedMember?1:0),
    env.DB.prepare(`DELETE FROM agent_route_members WHERE model_id=? AND profile_id NOT IN (${members.map(()=>'?').join(',')})`).bind(match[1],...members.map(member=>member.profileId))];
  for(const member of members)statements.push(env.DB.prepare(`INSERT INTO agent_route_members(model_id,profile_id,upstream_model_id,enabled,priority) VALUES(?,?,?,?,?)
    ON CONFLICT(model_id,profile_id) DO UPDATE SET upstream_model_id=excluded.upstream_model_id,enabled=excluded.enabled,priority=excluded.priority,
    verified_at=CASE WHEN ? AND COALESCE(agent_route_members.upstream_model_id,'')=COALESCE(excluded.upstream_model_id,'') THEN agent_route_members.verified_at ELSE NULL END,revision=agent_route_members.revision+1,updated_at=CURRENT_TIMESTAMP`).bind(match[1],member.profileId,member.upstreamModelId||null,member.enabled?1:0,member.priority,unchangedProtocol?1:0));
  if(body.enabled)statements.push(env.DB.prepare('UPDATE model_catalog SET agent_enabled=1 WHERE id=?').bind(match[1]));
  if(!unchangedProtocol)statements.push(env.DB.prepare('DELETE FROM agent_route_health WHERE model_id=?').bind(match[1]));
  await env.DB.batch(statements);
  await audit(env,admin.id,'opencode_route_pool_changed',{model:match[1],profileIds:members.map(member=>member.profileId),protocol:body.protocol,enabled:body.enabled});
  return reply({ok:true});
}
