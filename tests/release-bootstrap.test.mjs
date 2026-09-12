import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import entry, { bootstrap } from '../worker/scripts/bootstrap-metering.js';
const db=new DatabaseSync(':memory:');
for(const file of fs.readdirSync('worker/migrations').filter(f=>f.endsWith('.sql')).sort())db.exec(fs.readFileSync(`worker/migrations/${file}`,'utf8'));
function prepare(query){let args=[];return {bind(...a){args=a;return this;},async first(){return db.prepare(query).get(...args)||null;},async all(){return {results:db.prepare(query).all(...args)};},async run(){return {meta:{changes:Number(db.prepare(query).run(...args).changes)}};}};}
const env={BOTGO_MAINTENANCE:'1',BOTGO_RELEASE_BOOTSTRAP:'2026-09-12',UPSTREAM_BASE_URL:'https://www.lvzhouai.cc/v1',UPSTREAM_API_KEY:'test-only-secret',UPSTREAM_CONFIG_KEY:Buffer.alloc(32,7).toString('base64url'),DB:{prepare,async batch(statements){db.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}}}};
let calls=0;const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,init)=>{
 calls++;
 assert.notEqual(init.redirect,'error','Workers runtime rejects redirect:error');
 if(url.endsWith('/models'))return Response.json({data:[]});
 const body=JSON.parse(init.body);
 if(['gpt-5.4','gpt-6-astra'].includes(body.model))return new Response('',{status:429});
 const usage={input_tokens:2,output_tokens:1};
 const result=url.endsWith('/responses')?{type:'response.completed',response:{usage,output:[{type:'function_call',name:'botgo_probe',call_id:'test-call',arguments:'{"value":"OK"}'}]}}:{usage};
 return new Response(`data: ${JSON.stringify(result)}\n\n`,{headers:{'content-type':'text/event-stream'}});
};
try{
 assert.equal(entry.fetch().status,503);
 await bootstrap({...env,BOTGO_MAINTENANCE:'0'});assert.equal(calls,0);
 await bootstrap(env);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM upstream_routes').get().n,2);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM model_catalog WHERE enabled=1').get().n,4);
 assert.equal(db.prepare("SELECT event FROM security_audit WHERE id='release-2026-09-12-metering'").get().event,'release_bootstrap_completed');
 const row=db.prepare('SELECT * FROM upstream_profiles').get();assert.notEqual(row.api_key_ciphertext,env.UPSTREAM_API_KEY);assert.ok(!JSON.stringify(row).includes(env.UPSTREAM_API_KEY));
 const once=calls;await bootstrap(env);assert.equal(calls,once,'cron repeats must not probe or mutate again');
 db.exec('DELETE FROM security_audit');
 await assert.rejects(bootstrap(env),/EXISTING_ROUTES_REQUIRE_ADMIN_REVIEW/);
 assert.equal(calls,once,'existing operator routes are preserved');
 console.log('Release bootstrap: maintenance guard, real probe results, disabled failures, encrypted key, single run and existing route preservation passed');
}finally{globalThis.fetch=originalFetch;db.close();}
