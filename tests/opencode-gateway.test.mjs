import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {MODEL_SEEDS,meteredProxy,settle} from '../worker/src/metering.js';
import {agentRoutes,availableAgentRoutes,handleAgentAdmin,handleOpenCode} from '../worker/src/opencode-gateway.js';
import {encryptSecret} from '../worker/src/platform-admin.js';
import {revokeDesktopDevice} from '../worker/src/desktop-auth.js';

const sql=new DatabaseSync(':memory:');
for(const file of fs.readdirSync('worker/migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(`worker/migrations/${file}`,'utf8'));
sql.exec("INSERT INTO accounts(id,email,password_hash,credit_balance) VALUES('a','a@example.invalid','unused',1000),('b','b@example.invalid','unused',1000)");
sql.exec("INSERT INTO upstream_profiles(id,name,base_url,api_key_ciphertext,api_key_iv,key_hint) VALUES('p','test','https://upstream.invalid/v1','unused','unused','test'),('q','other','https://other.invalid/v1','unused','unused','test')");
for(const m of MODEL_SEEDS.slice(0,2))sql.prepare('INSERT INTO model_catalog(id,name,upstream_id,price_json,enabled,agent_enabled) VALUES(?,?,?,?,1,1)').run(m.id,m.name,m.id,JSON.stringify(m.price));
sql.exec("INSERT INTO agent_model_routes(model_id,profile_id,protocol,enabled,verified_at) VALUES('gpt-5.6-sol','p','chat',1,CURRENT_TIMESTAMP),('gpt-5.6-terra','p','responses',1,CURRENT_TIMESTAMP)");
function statement(query){let values=[];return {bind(...args){values=args;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};}
const env={DB:{prepare:statement,async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}}};
const balance=()=>sql.prepare("SELECT credit_balance*10000+credit_remainder_micros AS amount FROM accounts WHERE id='a'").get().amount;
const route=(await agentRoutes(env))[0];
assert.equal(availableAgentRoutes(await agentRoutes(env)).length,2);
const originalFetch=globalThis.fetch;
const jobs=[];const ctx={waitUntil(p){jobs.push(p);}};
const upstream={profileId:'p',baseUrl:'https://upstream.invalid/v1',apiKey:'fixture'};
const options={accountId:'a',channel:'desktop_opencode',agentRoute:route,taskId:'ses_test',upstream,body:{model:route.model_id,messages:[{role:'user',content:'hi'}]}};
try{
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://upstream.invalid/v1/chat/completions');
    const body=JSON.parse(init.body);assert.equal(body.stream_options.include_usage,true);assert.equal(body.max_output_tokens,undefined);
    return new Response('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: {"usage":{"prompt_tokens":100,"completion_tokens":10}}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  };
  const first=await meteredProxy(new Request('https://botgo.test/opencode/v1/chat/completions',{headers:{'idempotency-key':'opencode-task-123456'}}),env,ctx,options);
  assert.equal(first.status,200);await first.text();await Promise.all(jobs);
  assert.equal(balance(),9998740);
  const ledger=sql.prepare("SELECT * FROM metered_requests WHERE channel='desktop_opencode'").get();
  assert.equal(JSON.parse(ledger.snapshot).taskId,'ses_test');
  assert.equal(JSON.parse(ledger.snapshot).agentProtocol,'chat');
  await settle(env,ledger.id,{input_tokens:100,output_tokens:10},JSON.parse(ledger.snapshot));assert.equal(balance(),9998740);
  await settle(env,ledger.id,null,JSON.parse(ledger.snapshot),'review');
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM agent_route_health').get().n,0,'late cancellation cannot block a settled route');
  const responsesRoute=(await agentRoutes(env)).find(r=>r.protocol==='responses');
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://upstream.invalid/v1/responses');
    const body=JSON.parse(init.body);assert.equal(body.max_completion_tokens,undefined);assert.ok(body.max_output_tokens>0);
    return new Response('data: {"type":"response.completed","response":{"usage":{"input_tokens":0,"output_tokens":0}}}\n\n',{headers:{'content-type':'text/event-stream'}});
  };
  const responses=await meteredProxy(new Request('https://botgo.test/'),env,ctx,{...options,agentRoute:responsesRoute,body:{model:responsesRoute.model_id,input:'hi'}});
  assert.equal(responses.status,200);await responses.text();await Promise.all(jobs);
  globalThis.fetch=async()=>new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  const missing=await meteredProxy(new Request('https://botgo.test/'),env,ctx,options);await missing.text();await Promise.all(jobs);
  assert.equal(balance(),9998740,'missing usage does not invent a charge');
  assert.equal(sql.prepare("SELECT enabled FROM model_catalog WHERE id=?").get(route.model_id).enabled,1,'upstream issue must not disable the global model');
  assert.equal(availableAgentRoutes(await agentRoutes(env)).length,2,'missing usage does not globally remove an otherwise verified Agent route');
  const blocked=await meteredProxy(new Request('https://botgo.test/'),env,ctx,options);assert.equal(blocked.status,402,'the account that owns a review remains restricted without globally disabling the route');
  sql.exec('DELETE FROM agent_route_health');
  sql.exec("UPDATE metered_requests SET state='refunded' WHERE account_id='a' AND state='review'; UPDATE accounts SET billing_blocked=0 WHERE id='a'");
  const cancelledId='cancelled-stream';
  sql.prepare("INSERT INTO metered_requests(id,account_id,channel,model,snapshot,reserved_micros) VALUES(?,'a','desktop_opencode',?,?,1)")
    .run(cancelledId,route.model_id,JSON.stringify({billingModel:route.model_id,profileId:'p',agentProtocol:'chat'}));
  await settle(env,cancelledId,null,{billingModel:route.model_id,profileId:'p',agentProtocol:'chat'},'review',false);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM agent_route_health').get().n,0,'a client-cancelled stream must not block the upstream route');
  assert.equal(sql.prepare('SELECT review_reason FROM metered_requests WHERE id=?').get(cancelledId).review_reason,'client_cancelled','a client cancellation stays auditable');
  assert.equal(sql.prepare('SELECT review_required FROM metered_requests WHERE id=?').get(cancelledId).review_required,0,'a client cancellation does not require billing review');
  const denied=await handleAgentAdmin(new Request('https://botgo.test/',{method:'PUT',body:JSON.stringify({profileId:'q',protocol:'chat',enabled:true})}),env,'/admin/opencode/models/gpt-5.6-sol',{id:'a'},async()=>{});
  assert.equal(denied.status,409,'cannot enable a changed unverified route');
  const saved=await handleAgentAdmin(new Request('https://botgo.test/',{method:'PUT',body:JSON.stringify({profileId:'q',protocol:'chat',enabled:false})}),env,'/admin/opencode/models/gpt-5.6-sol',{id:'a'},async()=>{});
  assert.equal(saved.status,200);assert.equal(sql.prepare('SELECT verified_at FROM agent_model_routes WHERE model_id=?').get(route.model_id).verified_at,null);
  assert.equal((await agentRoutes(env)).find(item=>item.model_id===route.model_id).enabled,0,'route state is not replaced by its selected member state');
  const unauth=await handleOpenCode(new Request('https://botgo.test/opencode/v1/models'),env,ctx,'/opencode/v1/models');assert.equal(unauth.status,401);
  const reserve=id=>sql.prepare("INSERT INTO metered_requests(id,account_id,channel,model,snapshot,reserved_micros) VALUES(?,'b','desktop_opencode','gpt-5.6-sol','{}',1)").run(id);
  for(let n=0;n<3;n++){
    sql.prepare("INSERT INTO metered_requests(id,account_id,channel,model,snapshot,reserved_micros) VALUES(?,'b','web_chat','gpt-5.6-sol','{}',1)").run('old-review-'+n);
  }
  sql.exec("UPDATE metered_requests SET state='review' WHERE account_id='b' AND channel='web_chat'");
  for(let n=0;n<8;n++)reserve('parallel-'+n);
  assert.throws(()=>reserve('parallel-overflow'),/AGENT_CONCURRENCY_LIMIT/);
  assert.equal(sql.prepare("SELECT billing_reserved_micros FROM accounts WHERE id='b'").get().billing_reserved_micros,8,'failed parallel reservation is atomic');
  sql.exec("UPDATE metered_requests SET state='review',review_reason='client_cancelled',review_required=0 WHERE account_id='b'");
  assert.doesNotThrow(()=>reserve('after-cancelled-reviews'),'cancelled requests must not count toward the review limit');
  sql.exec("UPDATE metered_requests SET state='review',review_reason='missing_usage',review_required=1 WHERE account_id='b'");
  assert.throws(()=>reserve('review-overflow'),/AGENT_REVIEW_LIMIT/);
  // A real SQL device credential traverses session issuance, encryption, proxy and revocation.
  env.UPSTREAM_CONFIG_KEY=Buffer.alloc(32,7).toString('base64url');
  const encrypted=await encryptSecret('fixture-upstream-secret',env);
  sql.prepare('UPDATE upstream_profiles SET api_key_ciphertext=?,api_key_iv=? WHERE id=?').run(encrypted.ciphertext,encrypted.iv,'p');
  assert.equal(sql.prepare("SELECT verified_at FROM agent_model_routes WHERE model_id='gpt-5.6-terra'").get().verified_at,null,'credential changes invalidate prior probes');
  // Sol is in the catalog but is absent from the native session until its own route is verified and enabled.
  sql.exec("UPDATE agent_model_routes SET enabled=0,verified_at=NULL WHERE model_id='gpt-5.6-sol'");
  sql.exec("UPDATE agent_model_routes SET enabled=1,verified_at=CURRENT_TIMESTAMP WHERE model_id='gpt-5.6-terra'");
  const device='bgdt_fixturedevice',hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(device))).toString('base64url');
  sql.prepare("INSERT INTO device_tokens(token_hash,account_id,label,expires_at) VALUES(?,'a','fixture',?)").run(hash,new Date(Date.now()+86400000).toISOString());
  const sessionRequest=()=>new Request('https://botgo.test/desktop/opencode/session',{method:'POST',headers:{authorization:'Bearer '+device}});
  const hiddenSessionResponse=await handleOpenCode(sessionRequest(),env,ctx,'/desktop/opencode/session');
  assert.equal(hiddenSessionResponse.status,201);const hiddenSession=await hiddenSessionResponse.json();assert.ok(hiddenSession.key.startsWith('bgk_'));assert.equal(hiddenSession.models.some(model=>model.id==='gpt-5.6-sol'),false,'unverified or disabled Sol is never returned to a native session');
  const hiddenModels=await handleOpenCode(new Request('https://botgo.test/opencode/v1/models',{headers:{authorization:'Bearer '+hiddenSession.key}}),env,ctx,'/opencode/v1/models');
  assert.equal(hiddenModels.status,200);assert.equal((await hiddenModels.json()).data.some(model=>model.id==='gpt-5.6-sol'),false,'unverified or disabled Sol is never listed by the native models endpoint');
  sql.exec("UPDATE model_catalog SET enabled=1 WHERE id='gpt-5.6-sol'; UPDATE agent_model_routes SET profile_id='p',enabled=1,verified_at=CURRENT_TIMESTAMP WHERE model_id='gpt-5.6-sol'");
  const sessionResponse=await handleOpenCode(sessionRequest(),env,ctx,'/desktop/opencode/session');
  assert.equal(sessionResponse.status,201);const session=await sessionResponse.json();assert.ok(session.key.startsWith('bgk_'));assert.equal(session.models.some(model=>model.id==='gpt-5.6-sol'),true,'verified enabled Sol is returned to a native session');
  const visibleModels=await handleOpenCode(new Request('https://botgo.test/opencode/v1/models',{headers:{authorization:'Bearer '+session.key}}),env,ctx,'/opencode/v1/models');
  assert.equal(visibleModels.status,200);assert.equal((await visibleModels.json()).data.some(model=>model.id==='gpt-5.6-sol'),true,'verified enabled Sol is listed by the native models endpoint');
  assert.equal(JSON.stringify(session).includes('fixture-upstream-secret'),false,'upstream key never reaches client');
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://upstream.invalid/v1/chat/completions');assert.equal(init.headers.authorization,'Bearer fixture-upstream-secret');
    return new Response('data: {"usage":{"prompt_tokens":10,"completion_tokens":1}}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  };
  const runRequest=()=>new Request('https://botgo.test/opencode/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+session.key,'x-botgo-task-id':'native-fixture'},body:JSON.stringify(options.body)});
  const live=await handleOpenCode(runRequest(),env,ctx,'/opencode/v1/chat/completions');assert.equal(live.status,200);await live.text();await Promise.all(jobs);
  const totals=await handleOpenCode(new Request('https://botgo.test/opencode/usage?taskId=native-fixture',{headers:{authorization:'Bearer '+session.key}}),env,ctx,'/opencode/usage');
  assert.equal((await totals.json()).chargedMicros,126);
  sql.exec("UPDATE api_keys SET expires_at='2000-01-01 00:00:00' WHERE scope='desktop'");
  assert.equal((await handleOpenCode(runRequest(),env,ctx,'/opencode/v1/chat/completions')).status,401,'expired execution key is refused');
  sql.exec("UPDATE api_keys SET expires_at=NULL WHERE scope='desktop'");
  await revokeDesktopDevice(env,device);
  assert.equal((await handleOpenCode(runRequest(),env,ctx,'/opencode/v1/chat/completions')).status,401,'revoked device cannot spend');
  assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);
}finally{globalThis.fetch=originalFetch;sql.close();}
console.log('OpenCode gateway: additive migration, protocol routing, settlement, route isolation, config validation and atomic limits passed');
