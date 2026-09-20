import { probeAgentRoute } from './opencode-gateway.js';

const reply=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const modelIdPattern=/^[a-z0-9][a-z0-9._-]{0,127}$/;
const upstreamModelPattern=/^[A-Za-z0-9._:/-]{1,128}$/;
const priceKeys=['input','cached','write','output','longThreshold','longInput','longOutput'];

function validConfig(value,id){
  if(!value||!modelIdPattern.test(id)||id==='codex-auto-review'||typeof value.name!=='string'||!value.name.trim()||value.name.length>128||!upstreamModelPattern.test(value.upstreamId||''))return false;
  const price=value.price;let source;try{source=new URL(price?.source||'');}catch{return false;}
  if(price?.tier!=='default'||priceKeys.some(key=>!Number.isFinite(price[key])||price[key]<0||price[key]>10000000)||price.longThreshold<1||price.longInput<1||price.longOutput<1||source.protocol!=='https:'||source.username||source.password||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(price.date||''))return false;
  if(!Array.isArray(value.members)||value.members.length>50||new Set(value.members.map(item=>item.profileId)).size!==value.members.length)return false;
  return value.members.every(item=>/^[0-9a-f-]{36}$/i.test(item.profileId||'')&&upstreamModelPattern.test(item.upstreamModelId||'')&&['chat','responses'].includes(item.protocol)&&Number.isInteger(item.priority)&&item.priority>=0&&item.priority<=10000);
}

async function fingerprint(row,member){
  const text=[row.base_url,row.api_key_ciphertext,row.api_key_iv,member.upstreamModelId,member.protocol].join('\n');
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),byte=>byte.toString(16).padStart(2,'0')).join('');
}

function probeFailure(error){
  const raw=String(error?.message||'');
  const http=/^HTTP_(\d{3})$/.exec(raw);
  if(http)return {code:'UPSTREAM_HTTP',stage:'upstream_http',upstreamStatus:Number(http[1])};
  if(raw==='MISSING_USAGE'||raw==='INVALID_USAGE')return {code:raw,stage:'usage'};
  if(raw==='MISSING_TOOL')return {code:raw,stage:'tools'};
  if(raw==='EXPECTED_SSE'||raw==='PROBE_SIZE')return {code:raw,stage:'stream'};
  if(error?.name==='TimeoutError'||error?.name==='AbortError')return {code:'UPSTREAM_TIMEOUT',stage:'connection'};
  if(error instanceof SyntaxError)return {code:'INVALID_UPSTREAM_JSON',stage:'stream_or_tools'};
  return {code:'PROBE_FAILED',stage:'unknown'};
}

export async function handleModelServicesAdmin(request,env,path,admin,audit){
  if(!path.startsWith('/admin/model-services'))return null;
  if(path==='/admin/model-services'&&request.method==='GET'){
    const rows=(await env.DB.prepare('SELECT model_id,config_json,tested_json,updated_at FROM model_service_drafts ORDER BY updated_at DESC').all()).results||[];
    return reply({drafts:rows.map(row=>({modelId:row.model_id,config:JSON.parse(row.config_json),tested:JSON.parse(row.tested_json),updatedAt:row.updated_at}))});
  }
  const match=path.match(/^\/admin\/model-services\/([a-z0-9._-]+)(?:\/(test|publish))?$/);
  if(!match)return reply({error:'接口不存在。'},404);
  const id=match[1],operation=match[2];
  if(!operation&&request.method==='PUT'){
    const config=await request.json().catch(()=>null);
    if(!validConfig(config,id))return reply({error:'模型、价格或上游绑定无效。'},400);
    for(const member of config.members){const profile=await env.DB.prepare('SELECT id FROM upstream_profiles WHERE id=? AND retired_at IS NULL').bind(member.profileId).first();if(!profile)return reply({error:`上游 ${member.profileId} 不存在或已退役。`},409);}
    await env.DB.prepare("INSERT INTO model_service_drafts(model_id,config_json,tested_json) VALUES(?,?,'{}') ON CONFLICT(model_id) DO UPDATE SET config_json=excluded.config_json,tested_json='{}',updated_at=CURRENT_TIMESTAMP").bind(id,JSON.stringify(config)).run();
    await audit(env,admin.id,'model_service_draft_saved',{model:id});return reply({ok:true});
  }
  const row=await env.DB.prepare('SELECT config_json,tested_json FROM model_service_drafts WHERE model_id=?').bind(id).first();
  if(!row)return reply({error:'请先保存模型草稿。'},404);
  const config=JSON.parse(row.config_json),tested=JSON.parse(row.tested_json);
  if(operation==='test'&&request.method==='POST'){
    const results=[];
    for(const member of config.members){
      const profile=await env.DB.prepare('SELECT id,base_url,api_key_ciphertext,api_key_iv,retired_at FROM upstream_profiles WHERE id=?').bind(member.profileId).first();
      if(!profile||profile.retired_at){results.push({profileId:member.profileId,ok:false,code:'PROFILE_RETIRED'});delete tested[member.profileId];continue;}
      try{await probeAgentRoute(env,{profile_id:member.profileId,protocol:member.protocol},member.upstreamModelId);tested[member.profileId]=await fingerprint(profile,member);results.push({profileId:member.profileId,ok:true,stages:{stream:true,usage:true,tools:true,continuation:true}});}
      catch(error){delete tested[member.profileId];results.push({profileId:member.profileId,ok:false,...probeFailure(error)});}
    }
    await env.DB.prepare('UPDATE model_service_drafts SET tested_json=? WHERE model_id=? AND config_json=?').bind(JSON.stringify(tested),id,row.config_json).run();
    await audit(env,admin.id,'model_service_draft_tested',{model:id,results:results.map(({profileId,ok,code})=>({profileId,ok,code}))});
    return reply({ok:results.length>0&&results.every(result=>result.ok),results});
  }
  if(operation==='publish'&&request.method==='POST'){
    if(!config.members.length)return reply({error:'请先绑定至少一个上游。'},409);
    const protocols=new Set(config.members.map(member=>member.protocol));
    if(protocols.size!==1)return reply({error:'同一模型的上游必须使用相同协议。'},409);
    for(const member of config.members){
      const profile=await env.DB.prepare('SELECT id,base_url,api_key_ciphertext,api_key_iv,retired_at FROM upstream_profiles WHERE id=?').bind(member.profileId).first();
      if(!profile||profile.retired_at||tested[member.profileId]!==await fingerprint(profile,member))return reply({error:`上游 ${member.profileId} 的测试已过期，请重新测试。`},409);
    }
    const current=await env.DB.prepare('SELECT id FROM model_catalog WHERE id=? AND archived=0').bind(id).first();
    const primary=config.members[0],statements=[];
    if(!current)statements.push(env.DB.prepare('INSERT INTO model_catalog(id,name,upstream_id,price_json,enabled,web_enabled,agent_enabled) VALUES(?,?,?,?,1,0,1)').bind(id,config.name,config.upstreamId,JSON.stringify(config.price)));
    else statements.push(env.DB.prepare('UPDATE model_catalog SET name=?,upstream_id=?,price_json=?,enabled=1,web_enabled=0,agent_enabled=1,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(config.name,config.upstreamId,JSON.stringify(config.price),id));
    statements.push(env.DB.prepare('DELETE FROM agent_route_members WHERE model_id=?').bind(id));
    statements.push(env.DB.prepare(`INSERT INTO agent_model_routes(model_id,profile_id,protocol,enabled,verified_at) VALUES(?,?,?,1,CURRENT_TIMESTAMP) ON CONFLICT(model_id) DO UPDATE SET profile_id=excluded.profile_id,protocol=excluded.protocol,enabled=1,verified_at=CURRENT_TIMESTAMP,revision=revision+1,updated_at=CURRENT_TIMESTAMP`).bind(id,primary.profileId,primary.protocol));
    for(const member of config.members)statements.push(env.DB.prepare('INSERT INTO agent_route_members(model_id,profile_id,upstream_model_id,enabled,priority,verified_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)').bind(id,member.profileId,member.upstreamModelId,1,member.priority));
    await env.DB.batch(statements);
    await audit(env,admin.id,'model_service_published',{model:id,profileIds:config.members.map(member=>member.profileId)});
    return reply({ok:true});
  }
  return reply({error:'方法不支持。'},405);
}
