// Standard OpenAI API rate snapshot, USD per million tokens, 2026-09-12.
export const MODEL_SEEDS = [
  ['gpt-5.6-sol','GPT-5.6 Sol',4,.4,5,20],
  ['gpt-5.6-terra','GPT-5.6 Terra',2,.2,2.5,12],
  ['gpt-5.6-luna','GPT-5.6 Luna',.2,.02,.25,1.2],
  ['gpt-5.5','GPT-5.5',5,.5,5,30],
  ['gpt-6-astra','GPT-6 Astra',10,1,12.5,50]
].map(([id,name,input,cached,write,output]) => ({id,name,price:{input,cached,write,output,longThreshold:272000,longInput:2,longOutput:1.5,source:'https://developers.openai.com/api/docs/pricing',date:'2026-09-12',tier:'default'}}));

export const AUTO_REVIEW_MODEL_ID = 'codex-auto-review';
export const AUTO_REVIEW_BILLING_MODEL_ID = 'gpt-5.6-luna';

export const reply = (body,status=200) => Response.json(body,{status,headers:{'cache-control':'no-store'}});
export async function catalog(env) {
  const [rows,settings] = await Promise.all([
    env.DB.prepare("SELECT * FROM model_catalog WHERE id NOT IN ('gpt-5.4','codex-auto-review') AND archived=0 ORDER BY rowid").all(),
    env.DB.prepare('SELECT * FROM metering_settings WHERE id=1').first()
  ]);
  return {models:(rows.results||[]).map(r=>({...r,price:JSON.parse(r.price_json)})),settings};
}
export function publicCatalog({models,settings},capabilities={}) {
  return {defaultModel:settings.default_model,capabilities:{autoReview:capabilities.autoReview===true},models:models.filter(m=>m.id!==AUTO_REVIEW_MODEL_ID).map(m=>({id:m.id,name:m.name,enabled:!!m.enabled,web:!!m.web_enabled,agent:!!m.agent_enabled,price:m.price,multiplier:(m.multiplier_ppm??settings.multiplier_ppm)/1e6,usdCny:settings.usd_cny_ppm/1e6}))};
}
export async function autoReviewCapability(env,data) {
  if(env.AUTO_REVIEW_ENABLED!=='1')return false;
  const reviewer=data.models.find(model=>model.id===AUTO_REVIEW_BILLING_MODEL_ID);
  if(!reviewer?.enabled||!reviewer.agent_enabled)return false;
  const proof=await env.DB.prepare("SELECT p.status FROM upstream_routes r JOIN upstream_profiles u ON u.id=r.profile_id JOIN upstream_route_probes p ON p.profile_id=r.profile_id AND p.channel=r.channel WHERE r.channel='desktop_codex' AND u.base_url<>'' AND p.model_id=? AND p.status='ok' AND p.metering_verified=1 AND p.tested_at>datetime('now','-1 day') LIMIT 1").bind(reviewer.upstream_id).first();
  return Boolean(proof);
}
export function normalizedUsage(usage) {
  if (!usage) throw new Error('MISSING_USAGE');
  const input=usage.input_tokens??usage.prompt_tokens;
  const output=usage.output_tokens??usage.completion_tokens;
  const details=usage.input_tokens_details??usage.prompt_tokens_details??{};
  const cached=details.cached_tokens??0, write=details.cache_write_tokens??0;
  if (![input,output,cached,write].every(n=>Number.isSafeInteger(n)&&n>=0) || cached+write>input) throw new Error('INVALID_USAGE');
  return {input,output,cached,write};
}
export function costMicros(usage,snapshot) {
  const {input,output,cached,write}=normalizedUsage(usage);
  const p=snapshot.price, long=input>p.longThreshold;
  // Rates have up to six decimals; BigInt avoids float drift in tiny charges.
  const rate=n=>BigInt(Math.round(n*1e6));
  const inFactor=rate(long?p.longInput:1), outFactor=rate(long?p.longOutput:1);
  const sum=(BigInt(input-cached-write)*rate(p.input)+BigInt(cached)*rate(p.cached)+BigInt(write)*rate(p.write))*inFactor+BigInt(output)*rate(p.output)*outFactor;
  const numerator=sum*BigInt(snapshot.multiplierPpm)*BigInt(snapshot.usdCnyPpm);
  const denominator=10n**24n;
  const result=(numerator+denominator-1n)/denominator;
  if(result>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('COST_OVERFLOW');
  return Number(result);
}
export function usageObserver() {
  let buffer='',usage=null,invalid=false;
  const decoder=new TextDecoder();
  function line(value) {
    if(!value.startsWith('data:'))return;
    const data=value.slice(5).trim();if(!data||data==='[DONE]')return;
    try {const item=JSON.parse(data);const terminal=!item.type||['response.completed','response.incomplete','response.failed'].includes(item.type);const candidate=terminal?(item.usage??item.response?.usage):null;if(candidate){normalizedUsage(candidate);usage=candidate;}}
    catch {invalid=true;}
  }
  return {
    push(bytes){buffer+=decoder.decode(bytes,{stream:true});let pos;while((pos=buffer.indexOf('\n'))>=0){line(buffer.slice(0,pos).replace(/\r$/,''));buffer=buffer.slice(pos+1);}if(buffer.length>2*1024*1024)throw new Error('SSE_FRAME_TOO_LARGE');},
    finish(){buffer+=decoder.decode();if(buffer)line(buffer);return invalid?null:usage;},
    latest(){return invalid?null:usage;}
  };
}
export async function settle(env,id,usage,snapshot,state='completed') {
  let cost=0;
  try {if(usage)cost=costMicros(usage,snapshot);else if(state==='completed')state='review';}
  catch {state='review';usage=null;}
  const settled=await env.DB.prepare("UPDATE metered_requests SET state=?,cost_micros=?,usage_json=? WHERE id=? AND state='reserved'").bind(state,cost,usage?JSON.stringify(usage):null,id).run();
  // Late cancellation/duplicate completion must not change route health or costs.
  if(settled.meta?.changes===0)return;
  if(usage && snapshot.costPrice) {
    const estimate=costMicros(usage,{...snapshot,multiplierPpm:1000000,price:{...snapshot.price,...snapshot.costPrice}});
    await env.DB.prepare('UPDATE metered_requests SET upstream_cost_estimate_micros=? WHERE id=? AND upstream_cost_estimate_micros IS NULL').bind(estimate,id).run();
  }
  if(state==='review' && snapshot.agentProtocol) {
    await env.DB.prepare('INSERT INTO agent_route_health(model_id,profile_id,protocol,reason) VALUES(?,?,?,?) ON CONFLICT(model_id,profile_id,protocol) DO UPDATE SET reason=excluded.reason,blocked_at=CURRENT_TIMESTAMP')
      .bind(snapshot.billingModel,snapshot.profileId,snapshot.agentProtocol,'usage_review').run();
  } else if(state==='review') await env.DB.prepare("UPDATE model_catalog SET enabled=0 WHERE id=?").bind(snapshot.billingModel||snapshot.model).run();
}
export async function meteredProxy(request,env,ctx,{accountId,channel,body,upstream,history,billingModel=null,agentRoute=null,taskId=null}) {
  if(channel==='desktop_opencode' && (!agentRoute || !agentRoute.enabled || !agentRoute.verified_at || agentRoute.blocked_reason || agentRoute.model_id!==body.model || agentRoute.profile_id!==upstream.profileId))return reply({error:'Agent 路由未经验证。'},503);
  // Recover abandoned reservations only after the upstream timeout has elapsed.
  await env.DB.batch([
    env.DB.prepare("INSERT INTO agent_route_health(model_id,profile_id,protocol,reason) SELECT model,json_extract(snapshot,'$.profileId'),json_extract(snapshot,'$.agentProtocol'),'abandoned' FROM metered_requests WHERE account_id=? AND channel='desktop_opencode' AND state='reserved' AND created_at<datetime('now','-10 minutes') ON CONFLICT(model_id,profile_id,protocol) DO UPDATE SET reason='abandoned',blocked_at=CURRENT_TIMESTAMP").bind(accountId),
    env.DB.prepare("UPDATE model_catalog SET enabled=0 WHERE id IN (SELECT COALESCE(json_extract(snapshot,'$.billingModel'),model) FROM metered_requests WHERE account_id=? AND channel<>'desktop_opencode' AND state='reserved' AND created_at<datetime('now','-10 minutes'))").bind(accountId),
    env.DB.prepare("UPDATE metered_requests SET state='review' WHERE account_id=? AND state='reserved' AND created_at<datetime('now','-10 minutes')").bind(accountId)
  ]);
  const data=await catalog(env);
  if(agentRoute && await env.DB.prepare('SELECT reason FROM agent_route_health WHERE model_id=? AND profile_id=? AND protocol=?').bind(agentRoute.model_id,agentRoute.profile_id,agentRoute.protocol).first())return reply({error:'上游用量需要核对，请联系管理员。'},503);
  const requestedModel=body.model==='gpt-5.6'?data.settings.default_model:body.model;
  if(requestedModel===AUTO_REVIEW_MODEL_ID)return reply({error:'旧版自动审核协议不可用，请更新客户端。'},503);
  const model=data.models.find(m=>m.id===requestedModel);
  if(!model?.enabled || !(channel==='web_chat'?model.web_enabled:model.agent_enabled)) return reply({error:'所选模型暂不可用。'},400);
  const autoReview=channel==='desktop_codex'&&billingModel&&model.id===AUTO_REVIEW_BILLING_MODEL_ID&&model.id!==billingModel;
  if(billingModel&&model.id!==billingModel&&!autoReview)return reply({error:'执行凭据绑定模型与请求不一致，请重新连接。'},403);
  if(autoReview&&!await autoReviewCapability(env,data))return reply({error:'替我审批暂不可用：生产开关或 Luna 真实用量探测未通过。'},503);
  if(!autoReview && !agentRoute) {
    const proof=upstream.profileId?await env.DB.prepare("SELECT status FROM upstream_route_probes WHERE profile_id=? AND channel=? AND model_id=? AND status='ok' AND metering_verified=1").bind(upstream.profileId,channel,model.upstream_id).first():null;
    if(!proof)return reply({error:'当前渠道的模型尚未验证，请联系管理员。'},503);
  }
  if(body.service_tier && !['auto','default'].includes(body.service_tier)) return reply({error:'当前仅支持 Standard 计费。'},400);
  if(body.background || body.previous_response_id) return reply({error:'请发送完整上下文；暂不支持后台任务或上游会话引用。'},400);
  if(body.tools!==undefined&&(!Array.isArray(body.tools)||body.tools.some(t=>!t||!['function','custom','local_shell','shell','apply_patch'].includes(t.type)||(t.type==='shell'&&t.environment?.type!=='local')))) return reply({error:'暂不支持另行计费的托管工具。'},400);
  if(body.n!==undefined&&body.n!==1) return reply({error:'每次请求只支持一个结果。'},400);
  const price=model.price;
  const upstreamModel=model.upstream_id;
  const snapshot={requestedModel,billingModel:model.id,selectedModel:billingModel||model.id,requestPurpose:autoReview?'auto_review':'task',upstreamModel,profileId:upstream.profileId,price,revision:model.revision,multiplierPpm:model.multiplier_ppm??data.settings.multiplier_ppm,usdCnyPpm:data.settings.usd_cny_ppm,settingsRevision:data.settings.revision,
    ...(agentRoute?{agentProtocol:agentRoute.protocol,routeRevision:agentRoute.revision,taskId,costPrice:agentRoute.cost_price_json?JSON.parse(agentRoute.cost_price_json):null}: {})};
  const requested=body.max_output_tokens??body.max_completion_tokens??body.max_tokens??8192;
  if(!Number.isInteger(requested)||requested<1) return reply({error:'输出上限无效。'},400);
  const maxOutput=Math.min(requested,16384);
  const inputBound=new TextEncoder().encode(JSON.stringify(body)).length+4096;
  if(inputBound>1000000) return reply({error:'上下文过长，请开始新对话。'},413);
  const reserved=costMicros({input_tokens:inputBound,output_tokens:maxOutput},{...snapshot,price:{...price,input:Math.max(price.input,price.write)}});
  const retryKey=request.headers.get('idempotency-key');
  if(retryKey&&!/^[a-zA-Z0-9_-]{16,128}$/.test(retryKey))return reply({error:'请求标识无效。'},400);
  const id=retryKey?`${accountId}:${channel}:${retryKey}`:crypto.randomUUID();
  try {await env.DB.prepare('INSERT INTO metered_requests(id,account_id,channel,model,snapshot,reserved_micros) VALUES(?,?,?,?,?,?)').bind(id,accountId,channel,requestedModel,JSON.stringify(snapshot),reserved).run();}
  catch(error){
    const message=String(error);
    if(message.includes('UNIQUE'))return reply({error:'该请求已受理，请勿重复提交。',code:'REQUEST_EXISTS',requestId:id},409);
    if(message.includes('BILLING_INSUFFICIENT'))return reply({error:'余额不足或账户受限，请查看账户。',code:'BILLING_UNAVAILABLE'},402);
    if(message.includes('AGENT_CONCURRENCY_LIMIT'))return reply({error:'运行中的请求较多，请稍后再试。',code:'AGENT_CONCURRENCY_LIMIT'},429);
    if(message.includes('AGENT_REVIEW_LIMIT'))return reply({error:'用量待核对，请联系管理员。',code:'AGENT_REVIEW_LIMIT'},409);
    throw error;
  }
  const chat=agentRoute?agentRoute.protocol==='chat':channel==='web_chat';
  const payload={...body,model:upstreamModel,service_tier:'default',...(chat?{max_completion_tokens:maxOutput,stream:true,stream_options:{include_usage:true}}:{max_output_tokens:maxOutput})};
  delete payload.max_tokens;
  if(chat)delete payload.max_output_tokens;else delete payload.max_completion_tokens;
  const abort=new AbortController();
  const timeout=setTimeout(()=>abort.abort(),180000);
  let response;
  try {
    response=await fetch(`${upstream.baseUrl}/${chat?'chat/completions':'responses'}`,{method:'POST',headers:{authorization:`Bearer ${upstream.apiKey}`,'content-type':'application/json'},body:JSON.stringify(payload),signal:abort.signal,redirect:'manual'});
    if(!response.ok||!response.body){clearTimeout(timeout);await settle(env,id,null,snapshot,'refunded');return reply({error:'模型请求未完成，本次未扣费。'},response.status===429?429:502);}
  } catch {clearTimeout(timeout);await settle(env,id,null,snapshot,'refunded');return reply({error:'无法连接模型服务，本次未扣费。'},502);}
  const headers={'content-type':response.headers.get('content-type')||'application/json','cache-control':'no-store','x-botgo-request-id':id};
  if(!headers['content-type'].includes('text/event-stream')) {
    try {
      const reader=response.body.getReader();let size=0;const chunks=[];
      for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();throw new Error('RESPONSE_TOO_LARGE');}chunks.push(value);}
      const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
      const result=JSON.parse(new TextDecoder().decode(bytes));
      await settle(env,id,result.usage,snapshot);
      if(history)await history.result(result);
      return new Response(bytes,{headers});
    } catch {await settle(env,id,null,snapshot,'review');return reply({error:'用量待核对，本次尚未扣费。'},502);}
    finally {clearTimeout(timeout);}
  }
  const observer=usageObserver();const transform=new TransformStream();const writer=transform.writable.getWriter();const reader=response.body.getReader();
  // A downstream cancel must interrupt an idle upstream read as well as a write.
  writer.closed.catch(()=>{abort.abort();return reader.cancel().catch(()=>{});});
  const pipeline=(async()=>{
    try {for(;;){const {done,value}=await reader.read();if(done)break;observer.push(value);if(history)await history.push(value);await writer.write(value);}await settle(env,id,observer.finish(),snapshot);if(history)await history.finish('completed');await writer.close();}
    catch(error){abort.abort();await reader.cancel().catch(()=>{});try{await settle(env,id,observer.latest(),snapshot,observer.latest()?'completed':'review');if(history)await history.finish(abort.signal.aborted?'stopped':'failed');}finally{await writer.abort(error).catch(()=>{});}}
    finally {clearTimeout(timeout);}
  })();
  ctx.waitUntil(pipeline);
  return new Response(transform.readable,{headers});
}

export async function handleMeteringAdmin(request,env,path,admin,audit) {
  if(!path.startsWith('/admin/metering'))return null;
  if(request.method==='GET' && path==='/admin/metering') {
    const data=await catalog(env);const ledger=await env.DB.prepare('SELECT id,account_id,channel,model,state,cost_micros,charged_micros,upstream_cost_estimate_micros,usage_json,snapshot,created_at,reviewed_at,review_note FROM metered_requests ORDER BY created_at DESC LIMIT 100').all();
    return reply({...data,ledger:ledger.results||[]});
  }
  const body=await request.json().catch(()=>null);
  if(path==='/admin/metering/review'&&request.method==='POST'){
    if(typeof body?.id!=='string'||typeof body?.note!=='string'||body.note.trim().length<4||body.note.length>500)return reply({error:'请填写至少 4 字的核对说明。'},400);
    const record=await env.DB.prepare("SELECT account_id FROM metered_requests WHERE id=? AND state='review' AND reviewed_at IS NULL").bind(body.id).first();
    if(!record)return reply({error:'记录不存在或已核对。'},409);
    await env.DB.batch([
      env.DB.prepare("UPDATE metered_requests SET reviewed_at=CURRENT_TIMESTAMP,review_note=? WHERE id=? AND state='review' AND reviewed_at IS NULL").bind(body.note.trim(),body.id),
      env.DB.prepare("UPDATE accounts SET billing_blocked=0 WHERE id=? AND NOT EXISTS(SELECT 1 FROM metered_requests WHERE account_id=? AND state='review' AND reviewed_at IS NULL)").bind(record.account_id,record.account_id)
    ]);
    await audit(env,admin.id,'metering_reviewed',{requestId:body.id,note:body.note.trim()});return reply({ok:true});
  }
  if(path==='/admin/metering/seed' && request.method==='POST') {
    await env.DB.batch(MODEL_SEEDS.map(m=>env.DB.prepare('INSERT OR IGNORE INTO model_catalog(id,name,upstream_id,price_json) VALUES(?,?,?,?)').bind(m.id,m.name,m.id,JSON.stringify(m.price))));
    await audit(env,admin.id,'model_catalog_seeded',{});return reply({ok:true});
  }
  if(path==='/admin/metering/settings' && request.method==='PUT') {
    if(![body?.multiplierPpm,body?.usdCnyPpm].every(n=>Number.isSafeInteger(n)&&n>0&&n<=100000000))return reply({error:'倍率或汇率无效。'},400);
    const selected=await env.DB.prepare("SELECT id FROM model_catalog WHERE id=? AND enabled=1").bind(body.defaultModel||'').first();
    if(!selected)return reply({error:'默认模型尚未启用。'},400);
    await env.DB.prepare('UPDATE metering_settings SET multiplier_ppm=?,usd_cny_ppm=?,default_model=?,revision=revision+1 WHERE id=1').bind(body.multiplierPpm,body.usdCnyPpm,body.defaultModel).run();
    await audit(env,admin.id,'metering_settings_changed',{defaultModel:body.defaultModel,multiplierPpm:body.multiplierPpm,usdCnyPpm:body.usdCnyPpm});return reply({ok:true});
  }
  const match=path.match(/^\/admin\/metering\/models\/([a-z0-9.-]+)$/);
  if(match?.[1]===AUTO_REVIEW_MODEL_ID)return reply({error:'codex-auto-review 是保留的原生内部路由，不属于模型目录或价格配置。'},400);
  if(match&&request.method==='DELETE') {
    if(await env.DB.prepare('SELECT model_id FROM agent_model_routes WHERE model_id=?').bind(match[1]).first())return reply({error:'该模型仍有 OpenCode 路由配置，请先禁用模型并保留历史。'},409);
    const model=await env.DB.prepare('SELECT id,upstream_id FROM model_catalog WHERE id=? AND archived=0').bind(match[1]).first();
    if(!model)return reply({error:'模型不存在。'},404);
    const used=await env.DB.prepare('SELECT id FROM metering_settings WHERE default_model=? UNION ALL SELECT channel FROM upstream_routes WHERE model_id=?').bind(model.id,model.upstream_id).first();
    if(used)return reply({error:'请先更换默认模型或路由中的模型。'},409);
    const historical=await env.DB.prepare('SELECT id FROM metered_requests WHERE model=? LIMIT 1').bind(model.id).first();
    if(historical)await env.DB.prepare('UPDATE model_catalog SET archived=1,enabled=0,web_enabled=0,agent_enabled=0 WHERE id=?').bind(model.id).run();
    else await env.DB.prepare('DELETE FROM model_catalog WHERE id=?').bind(model.id).run();
    await audit(env,admin.id,'model_removed',{model:model.id,archived:!!historical});
    return reply({ok:true,archived:!!historical});
  }
  if(match&&request.method==='PUT') {
    const p=body?.price;
    let source;
    try{source=new URL(p?.source||'');}catch{}
    const validSource=source?.protocol==='https:'&&!source.username&&!source.password&&/^(developers\.)?openai\.com$/.test(source.hostname);
    if(!p||!['input','cached','write','output','longThreshold','longInput','longOutput'].every(k=>Number.isFinite(p[k])&&p[k]>=0&&p[k]<=10000000)||p.longThreshold<1||p.longInput<1||p.longOutput<1||p.tier!=='default'||!validSource||!/^\d{4}-\d{2}-\d{2}$/.test(p.date||''))return reply({error:'价格快照无效。'},400);
    if(body.multiplierPpm!==null&&(!Number.isSafeInteger(body.multiplierPpm)||body.multiplierPpm<=0||body.multiplierPpm>100000000))return reply({error:'模型倍率无效。'},400);
    const upstreamId=String(body.upstreamId||match[1]);
    if(!/^[a-zA-Z0-9._-]{1,128}$/.test(upstreamId))return reply({error:'上游模型标识无效。'},400);
    // Only successfully probed profile/channel/model combinations may be enabled.
    for(const [flag,channel] of [['web','web_chat'],['agent','desktop_codex']]) if(body.enabled&&body[flag]) {
      const probe=await env.DB.prepare("SELECT p.status FROM upstream_route_probes p JOIN upstream_routes r ON r.profile_id=p.profile_id AND r.channel=p.channel WHERE p.channel=? AND p.model_id=? AND p.status='ok' AND p.metering_verified=1 AND p.tested_at>datetime('now','-1 day') ORDER BY p.tested_at DESC LIMIT 1").bind(channel,upstreamId).first();
      const nativeProbe=!probe && flag==='agent'?await env.DB.prepare('SELECT model_id FROM agent_model_routes WHERE model_id=? AND verified_at IS NOT NULL').bind(match[1]).first():null;
      if(!probe&&!nativeProbe)return reply({error:`请先验证 ${channel} 的对应模型能力。`},409);
    }
    await env.DB.prepare('UPDATE model_catalog SET upstream_id=?,enabled=?,web_enabled=?,agent_enabled=?,multiplier_ppm=?,price_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(upstreamId,body.enabled?1:0,body.web?1:0,body.agent?1:0,body.multiplierPpm,JSON.stringify(p),match[1]).run();
    await audit(env,admin.id,'model_pricing_changed',{model:match[1],enabled:!!body.enabled,upstreamId,price:p,multiplierPpm:body.multiplierPpm});return reply({ok:true});
  }
  return reply({error:'计费接口不存在。'},404);
}
