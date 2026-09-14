import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {AUTO_REVIEW_BILLING_MODEL_ID,AUTO_REVIEW_MODEL_ID,autoReviewCapability,catalog,handleMeteringAdmin,meteredProxy,publicCatalog} from '../worker/src/metering.js';

const sql=new DatabaseSync(':memory:');
for(const name of fs.readdirSync('worker/migrations').filter(name=>name.endsWith('.sql')).sort())sql.exec(fs.readFileSync(`worker/migrations/${name}`,'utf8'));
sql.exec("INSERT INTO accounts(id,email,password_hash,credit_balance) VALUES('review-account','review@example.invalid','unused',1000)");
sql.exec("INSERT INTO upstream_profiles(id,name,base_url,api_key_ciphertext,api_key_iv,key_hint) VALUES('review-profile','review','https://provider.example/v1','unused','unused','test')");
sql.exec("INSERT INTO upstream_routes(channel,profile_id,model_id) VALUES('desktop_codex','review-profile','gpt-5.6-sol')");
const price='{"input":1,"cached":0.1,"write":1,"output":4,"longThreshold":272000,"longInput":2,"longOutput":1.5,"tier":"default","source":"https://developers.openai.com/api/docs/pricing","date":"2026-09-13"}';
sql.prepare("INSERT INTO model_catalog(id,name,upstream_id,enabled,web_enabled,agent_enabled,price_json) VALUES(?,?,?,?,?,?,?)").run('gpt-5.6-sol','Sol','vendor-sol',1,0,1,price);
sql.prepare("INSERT INTO model_catalog(id,name,upstream_id,enabled,web_enabled,agent_enabled,price_json) VALUES(?,?,?,?,?,?,?)").run('gpt-5.6-terra','Terra','vendor-terra',1,0,1,price);
sql.prepare("INSERT INTO model_catalog(id,name,upstream_id,enabled,web_enabled,agent_enabled,price_json) VALUES(?,?,?,?,?,?,?)").run(AUTO_REVIEW_BILLING_MODEL_ID,'Luna','vendor-luna',1,0,1,price);
sql.exec("INSERT INTO upstream_route_probes(profile_id,channel,model_id,status,metering_verified) VALUES('review-profile','desktop_codex','vendor-sol','ok',1)");
sql.exec("INSERT INTO upstream_route_probes(profile_id,channel,model_id,status,metering_verified) VALUES('review-profile','desktop_codex','vendor-terra','ok',1)");
sql.exec("INSERT INTO upstream_route_probes(profile_id,channel,model_id,status,metering_verified) VALUES('review-profile','desktop_codex','vendor-luna','ok',1)");
function statement(query){let values=[];return {bind(...args){values=args;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){const result=sql.prepare(query).run(...values);return {meta:{changes:Number(result.changes)}};}};}
const env={AUTO_REVIEW_ENABLED:'1',DB:{prepare:statement,async batch(statements){sql.exec('BEGIN');try{const results=[];for(const item of statements)results.push(await item.run());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}}};

const models=await catalog(env);
assert.equal(models.models.some(model=>model.id===AUTO_REVIEW_MODEL_ID),false,'the native reviewer is not a catalog or pricing model');
assert.equal(publicCatalog(models).models.some(model=>model.id===AUTO_REVIEW_MODEL_ID),false);
const reservedUpdate=await handleMeteringAdmin(new Request('https://botgo.test/admin/metering/models/codex-auto-review',{method:'PUT',body:'{}'}),env,'/admin/metering/models/codex-auto-review',{id:'admin'},async()=>{});
assert.equal(reservedUpdate.status,400,'the reserved native route cannot be configured as a priced model');
assert.equal(await autoReviewCapability({...env,AUTO_REVIEW_ENABLED:'0'},models),false,'the production switch defaults capability off');
assert.equal(await autoReviewCapability(env,models),true,'the active route and fresh real reviewer usage probe enable capability');

const originalFetch=globalThis.fetch,jobs=[];let calls=0,includeUsage=true;
try{
  globalThis.fetch=async(_url,init)=>{calls++;const payload=JSON.parse(init.body);assert.ok(['vendor-sol','vendor-luna'].includes(payload.model));const completed={type:'response.completed',response:{output:[{type:'message',content:[]}]}};if(includeUsage)completed.response.usage={input_tokens:20,output_tokens:5};return new Response(`data: ${JSON.stringify(completed)}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});};
  const base={accountId:'review-account',channel:'desktop_codex',upstream:{profileId:'review-profile',baseUrl:'https://provider.example/v1',apiKey:'test-only'},billingModel:'gpt-5.6-sol'};
  const legacyReview=await meteredProxy(new Request('https://botgo.test/v1/responses',{method:'POST'}),env,{waitUntil:promise=>jobs.push(promise)},{...base,billingModel:null,body:{model:AUTO_REVIEW_MODEL_ID,input:'review'}});
  assert.equal(legacyReview.status,503,'the obsolete synthetic reviewer ID is never forwarded upstream');
  const main=await meteredProxy(new Request('https://botgo.test/v1/responses',{method:'POST',headers:{'idempotency-key':'main-task-request-123456'}}),env,{waitUntil:promise=>jobs.push(promise)},{...base,body:{model:'gpt-5.6-sol',input:'work'}});
  assert.equal(main.status,200);await main.text();await Promise.all(jobs);
  const mismatch=await meteredProxy(new Request('https://botgo.test/v1/responses',{method:'POST'}),env,{waitUntil:promise=>jobs.push(promise)},{...base,body:{model:'gpt-5.6-terra',input:'work'}});
  assert.equal(mismatch.status,403);assert.equal(calls,1,'a differently bound key cannot call another ordinary model');
  const response=await meteredProxy(new Request('https://botgo.test/v1/responses',{method:'POST',headers:{'idempotency-key':'auto-review-request-123456'}}),env,{waitUntil:promise=>jobs.push(promise)},{...base,body:{model:AUTO_REVIEW_BILLING_MODEL_ID,input:'review'}});
  assert.equal(response.status,200);await response.text();await Promise.all(jobs);
  const ledger=sql.prepare("SELECT * FROM metered_requests WHERE id='review-account:desktop_codex:auto-review-request-123456'").get();
  const snapshot=JSON.parse(ledger.snapshot);
  assert.equal(ledger.state,'completed');assert.ok(ledger.charged_micros>0);
  assert.equal(snapshot.requestedModel,AUTO_REVIEW_BILLING_MODEL_ID);assert.equal(snapshot.billingModel,AUTO_REVIEW_BILLING_MODEL_ID);assert.equal(snapshot.selectedModel,'gpt-5.6-sol');assert.equal(snapshot.requestPurpose,'auto_review');assert.equal(snapshot.upstreamModel,'vendor-luna');
  assert.equal(snapshot.price.source,'https://developers.openai.com/api/docs/pricing','review billing snapshots the actual Luna reviewer price');
  assert.deepEqual(sql.prepare("SELECT model FROM metered_requests WHERE account_id='review-account' ORDER BY model").all().map(row=>row.model),['gpt-5.6-luna','gpt-5.6-sol']);
  const duplicate=await meteredProxy(new Request('https://botgo.test/v1/responses',{method:'POST',headers:{'idempotency-key':'auto-review-request-123456'}}),env,{waitUntil:promise=>jobs.push(promise)},{...base,body:{model:AUTO_REVIEW_BILLING_MODEL_ID,input:'review'}});
  assert.equal(duplicate.status,409);assert.equal(calls,2,'retrying a settled reviewer request does not call or charge twice');

  includeUsage=false;
  const missing=await meteredProxy(new Request('https://botgo.test/v1/responses',{method:'POST',headers:{'idempotency-key':'auto-review-missing-usage'}}),env,{waitUntil:promise=>jobs.push(promise)},{...base,body:{model:AUTO_REVIEW_BILLING_MODEL_ID,input:'review'}});
  assert.equal(missing.status,200);await missing.text();await Promise.all(jobs);
  const pending=sql.prepare("SELECT state,charged_micros FROM metered_requests WHERE id='review-account:desktop_codex:auto-review-missing-usage'").get();
  assert.equal(pending.state,'review');assert.equal(pending.charged_micros,0,'missing reviewer usage releases the reservation and requires reconciliation');
  assert.equal(await autoReviewCapability(env,await catalog(env)),false,'runtime usage failure closes the capability');

  sql.prepare("UPDATE model_catalog SET enabled=1 WHERE id=?").run(AUTO_REVIEW_BILLING_MODEL_ID);
  sql.exec("UPDATE accounts SET credit_balance=0,credit_remainder_micros=0,billing_blocked=0 WHERE id='review-account'");
  includeUsage=true;
  const insufficient=await meteredProxy(new Request('https://botgo.test/v1/responses',{method:'POST',headers:{'idempotency-key':'auto-review-insufficient-123'}}),env,{waitUntil:promise=>jobs.push(promise)},{...base,body:{model:AUTO_REVIEW_BILLING_MODEL_ID,input:'review'}});
  assert.equal(insufficient.status,402);assert.equal(calls,3,'insufficient balance stops before the upstream reviewer request');
  sql.prepare("UPDATE upstream_route_probes SET tested_at=datetime('now','-2 days') WHERE model_id='vendor-luna'").run();
  assert.equal(await autoReviewCapability(env,await catalog(env)),false,'a reviewer probe older than 24 hours disables capability');
}finally{globalThis.fetch=originalFetch;sql.close();}
console.log('Auto review: native Luna route, actual-model billing, key binding, settlement, retries and gates passed');
