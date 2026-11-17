import assert from 'node:assert/strict';
import {createWebChatRuntime} from './fixtures/web-chat-runtime.mjs';
import {handleWebChat} from '../worker/src/web-chat.js';
import {imageToolHistory,selectionRequestId} from '../worker/src/web-chat-tools.js';
const runtime=await createWebChatRuntime({imagesFixture:true,searchFixture:true}),{db,env}=runtime,jobs=[];
const call=(path,method='GET',body)=>handleWebChat(new Request('https://botgo.test'+path,{method,headers:{origin:'https://botgo.test','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(p){jobs.push(p);}},path,{sub:'fixture-a'});
const drain=async()=>{while(jobs.length)await Promise.all(jobs.splice(0));};
const balance=()=>db.prepare("SELECT billing_reserved_micros n FROM accounts WHERE id='fixture-a'").get().n;
try{
 const convo=await(await call('/conversations','POST',{title:'自动工具'})).json();
 for(const model of runtime.models)for(const mode of ['normal','image-tool-json']){
  runtime.setUpstreamMode(mode);const requestId=crypto.randomUUID(),body={conversationId:convo.id,requestId,model:model.id,content:'画一个蓝色机器人'},start=runtime.upstreamCalls.length;
  const r=await call('/chat/stream','POST',body),text=await r.text();await drain();assert.match(text,/botgo.image.completed/);assert.equal(runtime.upstreamCalls.length,start+2,'one model decision and one image, no redundant tool loop');
  const payload=runtime.upstreamCalls[start];assert.equal(payload.tool_choice,'auto');assert.equal(payload.parallel_tool_calls,false);assert.ok(payload.tools.some(t=>(t.name||t.function?.name)==='generate_image'));
  if(model.protocol==='responses'||model.id==='gpt-6.1-sol')assert.ok(payload.tools.some(t=>t.type==='web_search'),'image tool coexists with native search');
  const saved=await(await call('/conversations/'+convo.id)).json();const answer=saved.messages.at(-1);assert.equal(answer.state,'completed');assert.equal(answer.kind,'image');assert.equal(answer.images.length,1);assert.equal(answer.params.prompt,body.content);
  const rows=db.prepare("SELECT * FROM metered_requests WHERE id IN (?,?)").all('fixture-a:web_chat:'+requestId,'fixture-a:web_chat:'+await selectionRequestId(requestId));assert.equal(rows.length,2);assert.ok(rows.every(t=>t.state==='completed'));assert.notEqual(rows[0].model,rows[1].model);assert.equal(balance(),0);
  const before=runtime.upstreamCalls.length;assert.equal((await call('/chat/stream','POST',body)).status,409);await drain();assert.equal(runtime.upstreamCalls.length,before);
  assert.equal((await(await call('/chat/cancel','POST',body)).json()).state,'completed','late stop keeps completed billing');
 }
 runtime.setUpstreamMode('normal');let requestId=crypto.randomUUID(),start=runtime.upstreamCalls.length;
 const text=await(await call('/chat/stream','POST',{conversationId:convo.id,requestId,model:runtime.models[1].id,content:'你好'})).text();await drain();assert.doesNotMatch(text,/botgo.image.completed/);assert.equal(runtime.upstreamCalls.length,start+1,'greeting never invokes images');
 for(const mode of ['image-invalid','image-no-usage']){runtime.setUpstreamMode(mode);requestId=crypto.randomUUID();const text=await(await call('/chat/stream','POST',{conversationId:convo.id,requestId,model:runtime.models[1].id,content:'画一个蓝色机器人'})).text();await drain();assert.match(text,/botgo.image.failed/);assert.equal(db.prepare('SELECT state FROM web_chat_turns WHERE request_id=?').get(requestId).state,'failed');assert.equal(db.prepare('SELECT state FROM metered_requests WHERE id=?').get('fixture-a:web_chat:'+requestId).state,'refunded');assert.equal(balance(),0);}
 // Stop during the model decision refunds its child reservation immediately.
 runtime.setUpstreamMode('hold');requestId=crypto.randomUUID();const body={conversationId:convo.id,requestId,model:runtime.models[1].id,content:'画一个蓝色机器人'},r=await call('/chat/stream','POST',body),reader=r.body.getReader();
 while(!db.prepare('SELECT id FROM metered_requests WHERE id=?').get('fixture-a:web_chat:'+await selectionRequestId(requestId)))await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal((await(await call('/chat/cancel','POST',body)).json()).state,'stopped');assert.equal(balance(),0);await reader.cancel();await drain();assert.equal(db.prepare("SELECT COUNT(*) n FROM upstream_leases WHERE state='active'").get().n,0);
 // Stop after the decision, while the image POST is running. Preserve completed
 // decision tokens; release only the unfinished image reservation and lease.
 runtime.setUpstreamMode('normal');const fixtureFetch=globalThis.fetch;let imageStarted=false;
 globalThis.fetch=async(url,init)=>{if(String(url).endsWith('/images/generations')){imageStarted=true;return await new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));}return fixtureFetch(url,init);};
 const imageBody={...body,requestId:crypto.randomUUID()},imageStream=await call('/chat/stream','POST',imageBody),imageReader=imageStream.body.getReader();
 const consuming=(async()=>{try{while(!(await imageReader.read()).done){}}catch{}})();
 while(!imageStarted)await new Promise(resolve=>setTimeout(resolve,5));
 assert.equal((await(await call('/chat/cancel','POST',imageBody)).json()).state,'stopped');assert.equal(balance(),0);await consuming;await drain();
 assert.equal(db.prepare('SELECT state FROM metered_requests WHERE id=?').get('fixture-a:web_chat:'+await selectionRequestId(imageBody.requestId)).state,'completed');assert.equal(db.prepare('SELECT state FROM metered_requests WHERE id=?').get('fixture-a:web_chat:'+imageBody.requestId).state,'refunded');assert.equal(db.prepare("SELECT COUNT(*) n FROM upstream_leases WHERE state='active'").get().n,0);globalThis.fetch=fixtureFetch;
 // Reject arbitrary, malformed or duplicate tool calls even if text exists.
 for(const tools of [[{name:'shell',arguments:'{}'}],[{name:'generate_image',arguments:'{"prompt":"x","size":"giant"}'}],[{name:'generate_image',arguments:'{"prompt":"x","size":"1024x1024","quality":"high"}'}],[{name:'generate_image',arguments:'{}'},{name:'generate_image',arguments:'{}'}]]){
  const tool=imageToolHistory({cancelled:async()=>false,hasAnswer:()=>true,validateResult:()=>true,push:async()=>{},finish:async()=>{},result:async()=>{}});
  assert.throws(()=>tool.history.validateResult({output:tools.map(t=>({type:'function_call',...t}))}));
 }
 console.log('Automatic image tool: Chat/Responses JSON/SSE, search coexistence, no-image greeting, one dispatch, separate verified billing, private saved history, replay/late stop, child cancellation and invalid tool/output passed');
}finally{await drain();runtime.close();}
