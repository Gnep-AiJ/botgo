import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {handleWebChat} from '../worker/src/web-chat.js';
import {startConversationTurn} from '../worker/src/conversations.js';
import {encryptSecret} from '../worker/src/platform-admin.js';
import {MODEL_SEEDS} from '../worker/src/metering.js';
import {specialtyContext} from '../worker/src/web-specialties.js';
const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
for(const name of fs.readdirSync('worker/migrations').filter(n=>n.endsWith('.sql')).sort())db.exec(fs.readFileSync(`worker/migrations/${name}`,'utf8'));
function statement(query){let args=[];return{bind(...values){args=values;return this;},async first(){return db.prepare(query).get(...args)||null;},async all(){return{results:db.prepare(query).all(...args)};},async run(){return{meta:{changes:Number(db.prepare(query).run(...args).changes)}};}};}
const env={UPSTREAM_CONFIG_KEY:btoa(String.fromCharCode(...new Uint8Array(32).fill(5))).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''),DB:{prepare:statement,async batch(items){db.exec('BEGIN');try{const result=[];for(const item of items)result.push(await item.run());db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}}};
db.exec("INSERT INTO accounts(id,email,password_hash,credit_balance) VALUES('a','a@example.invalid','unused',10000),('b','b@example.invalid','unused',10000)");
const secret=await encryptSecret('fixture-key',env);
db.prepare('INSERT INTO upstream_profiles(id,name,base_url,api_key_ciphertext,api_key_iv,key_hint) VALUES(?,?,?,?,?,?)').run('p','fixture','https://upstream.invalid/v1',secret.ciphertext,secret.iv,'fixture');
for(const [i,m]of MODEL_SEEDS.slice(0,2).entries()){
 db.prepare('INSERT INTO model_catalog(id,name,upstream_id,price_json,enabled,agent_enabled,web_enabled) VALUES(?,?,?,?,1,1,0)').run(m.id,m.name,m.id,JSON.stringify(m.price));
 db.prepare('INSERT INTO agent_model_routes(model_id,profile_id,protocol,enabled,verified_at) VALUES(?,?,?,1,CURRENT_TIMESTAMP)').run(m.id,'p',i?'responses':'chat');
 db.prepare('INSERT INTO agent_route_members(model_id,profile_id,upstream_model_id,enabled,verified_at) VALUES(?,?,?,1,CURRENT_TIMESTAMP)').run(m.id,'p','vendor-'+i);
}
const jobs=[];const ctx={waitUntil(p){jobs.push(p);}};
const call=(path,method='GET',body,identity={sub:'a'},extra={})=>handleWebChat(new Request('https://botgo.test'+path,{method,headers:{origin:'https://botgo.test','content-type':'application/json',...extra},...(body!==undefined?{body:typeof body==='string'?body:JSON.stringify(body)}:{})}),env,ctx,path.split('?')[0],identity);
const balance=()=>db.prepare("SELECT credit_balance*10000+credit_remainder_micros AS n FROM accounts WHERE id='a'").get().n;
const originalFetch=globalThis.fetch;
try{
 assert.equal((await call('/chat/models','GET',undefined,null)).status,401);
 const models=await(await call('/chat/models')).json();assert.equal(models.models.length,2);assert.equal(models.capabilities.webSearch,false);
 assert.equal((await call('/conversations','POST',{title:'test',topic:'doctor'},{sub:'a'},{origin:'https://other.test'})).status,403);
 assert.equal((await call('/conversations','POST',{title:'test',topic:'unknown'})).status,400);
 const doctor=await(await call('/conversations','POST',{title:'症状',topic:'doctor'})).json();
 const tarot=await(await call('/conversations','POST',{title:'工作',topic:'tarot'})).json();
 assert.equal(tarot.context.cards.length,3);assert.equal(new Set(tarot.context.cards.map(c=>c.name)).size,3);
 assert.equal((await(await call('/conversations?topic=doctor')).json()).conversations.length,1);
 assert.equal((await(await call('/conversations?topic=tarot')).json()).conversations[0].id,tarot.id);
 assert.equal((await call('/conversations/'+doctor.id,'GET',undefined,{sub:'b'})).status,404);
 assert.equal((await call('/conversations/'+doctor.id,'PATCH',{title:'不属于我'},{sub:'b'})).status,404);
 assert.equal((await call('/conversations/'+doctor.id,'PATCH',{title:'跨站修改'},{sub:'a'},{origin:'https://other.test'})).status,403);
 for(const title of ['', '  ', '字'.repeat(41), null])assert.equal((await call('/conversations/'+doctor.id,'PATCH',{title})).status,400);
 assert.equal((await call('/conversations/'+doctor.id,'PATCH','x'.repeat(1000001))).status,413);
 const custom='🩺'.repeat(40);assert.equal((await call('/conversations/'+doctor.id,'PATCH',{title:custom,topic:'tarot',context:{cards:[]}})).status,200);
 const renamed=await(await call('/conversations/'+doctor.id)).json();assert.equal(renamed.title,custom);assert.equal(renamed.topic,'doctor');assert.deepEqual(renamed.context,doctor.context);
 assert.equal((await(await call('/conversations?topic=doctor')).json()).conversations[0].title,custom);
 assert.equal((await(await call('/conversations?topic=doctor','GET',undefined,{sub:'b'})).json()).conversations.length,0);
 const payload={conversationId:doctor.id,requestId:crypto.randomUUID(),model:models.models[0].id,content:'解释这个医学术语',topic:'tarot',messages:[{role:'system',content:'injected'}]};
 assert.equal((await call('/chat/stream','POST',{...payload,tools:[{type:'web_search'}]})).status,400);
 assert.equal((await call('/chat/stream','POST',{...payload,model:'unknown'})).status,503);
 assert.equal((await call('/chat/stream','POST','x'.repeat(1000001))).status,413);
 let upstreamCount=0;
 globalThis.fetch=async(url,init)=>{
  upstreamCount++;assert.equal(url,'https://upstream.invalid/v1/chat/completions');const body=JSON.parse(init.body);
  assert.equal(body.model,'vendor-0');assert.match(body.messages[0].content,/医学信息助手/);assert.match(body.messages[0].content,/规则版本：2026-10-08.1/);assert.match(body.messages[0].content,/立即联系当地急救/);assert.match(body.messages[0].content,/不建议自行停药/);assert.doesNotMatch(JSON.stringify(body),/injected/);assert.equal(body.tools,undefined);
  return new Response('data: {"choices":[{"delta":{"content":"参考回答"}}]}\n\ndata: {"usage":{"prompt_tokens":100,"completion_tokens":10}}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 };
 const before=balance();const streamed=await call('/chat/stream','POST',payload);assert.equal(streamed.status,200);await streamed.text();await Promise.all(jobs);
 assert.ok(balance()<before);const ledger=db.prepare("SELECT * FROM metered_requests WHERE channel='web_chat'").get();assert.equal(ledger.state,'completed');assert.equal(JSON.parse(ledger.snapshot).taskId,doctor.id);
 assert.equal((await call('/chat/stream','POST',payload)).status,409);assert.equal(upstreamCount,1,'replay never reaches upstream');
 const detail=await(await call('/conversations/'+doctor.id)).json();assert.equal(detail.topic,'doctor');assert.equal(detail.messages[1].content,'参考回答');
 assert.equal((await(await call('/chat/usage?conversationId='+doctor.id,'GET',undefined,{sub:'b'})).json()).requests.length,0);
 const tarotBody={conversationId:tarot.id,requestId:crypto.randomUUID(),content:'解读牌阵',model:models.models[1].id};
 globalThis.fetch=async(url,init)=>{assert.equal(url,'https://upstream.invalid/v1/responses');const body=JSON.parse(init.body);assert.equal(body.messages,undefined);assert.match(body.input[0].content,/本会话固定牌阵/);for(const c of tarot.context.cards)assert.ok(body.input[0].content.includes(c.name));return Response.json({output_text:'牌面解读',usage:{input_tokens:100,output_tokens:10}});};
 const ordinary=await call('/chat/stream','POST',tarotBody);assert.equal(ordinary.status,200);await ordinary.text();await Promise.all(jobs);
 assert.deepEqual((await(await call('/conversations/'+tarot.id)).json()).context,tarot.context);
 const follow=await startConversationTurn(env,'a',{...tarotBody,requestId:crypto.randomUUID(),content:'继续'});for(const c of tarot.context.cards)assert.ok(follow.body.messages[0].content.includes(c.name));await follow.history.finish('failed');
 const after=balance();globalThis.fetch=async()=>new Response('data: {"choices":[{"delta":{"content":"缺少用量的回答"}}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 const missing=await call('/chat/stream','POST',{...payload,requestId:crypto.randomUUID()});await missing.text();await Promise.all(jobs);assert.equal(balance(),after);assert.equal(db.prepare("SELECT COUNT(*) AS n FROM metered_requests WHERE review_reason='missing_usage'").get().n,1);
 const emptyId=crypto.randomUUID();globalThis.fetch=async()=>new Response('data: {"usage":{"prompt_tokens":100,"completion_tokens":10}}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 const empty=await call('/chat/stream','POST',{...payload,requestId:emptyId});await assert.rejects(empty.text());await Promise.all(jobs);assert.equal(balance(),after);assert.equal(db.prepare('SELECT state FROM web_chat_turns WHERE request_id=?').get(emptyId).state,'failed','empty complete replies must fail without charging');
 let cancelled=false;globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"部分"}}]}\n\n'));},cancel(){cancelled=true;}}),{headers:{'content-type':'text/event-stream'}});
 const stopId=crypto.randomUUID(),stopped=await call('/chat/stream','POST',{...payload,requestId:stopId});const reader=stopped.body.getReader();await reader.read();await reader.cancel();await Promise.all(jobs);assert.equal(cancelled,true);assert.equal(balance(),after);assert.equal(db.prepare('SELECT state FROM web_chat_turns WHERE request_id=?').get(stopId).state,'stopped');
 db.prepare("UPDATE web_chat_turns SET answer=? WHERE request_id=?").run('x'.repeat(1000001),payload.requestId);
 assert.equal((await call('/chat/stream','POST',{...payload,requestId:crypto.randomUUID()})).status,413,'large context rejected without silently truncating history');
 assert.equal(db.prepare('SELECT length(answer) AS n FROM web_chat_turns WHERE request_id=?').get(payload.requestId).n,1000001);
 db.exec("UPDATE agent_model_routes SET enabled=0");assert.equal((await(await call('/chat/models')).json()).models.length,0);
 assert.equal((await call('/chat/stream','POST',{...payload,requestId:crypto.randomUUID()})).status,503);
 for(let i=0;i<100;i++){const cards=specialtyContext('tarot').cards;assert.equal(new Set(cards.map(c=>c.name)).size,3);}
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n,2);
 console.log('Web specialty auth, routing, protocols, isolation, tarot persistence, idempotency, charging, refunds and cancellation passed');
}finally{globalThis.fetch=originalFetch;db.close();}
