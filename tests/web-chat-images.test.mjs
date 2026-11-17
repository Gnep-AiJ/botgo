import assert from 'node:assert/strict';
import {createWebChatRuntime} from './fixtures/web-chat-runtime.mjs';
import {handleWebChat} from '../worker/src/web-chat.js';
import {purgeWebChatImages} from '../worker/src/web-chat-images.js';
const runtime=await createWebChatRuntime({imagesFixture:true}),{db,env}=runtime,jobs=[];
const call=(path,method='GET',body,account='fixture-a')=>handleWebChat(new Request('https://botgo.test'+path,{method,headers:{origin:'https://botgo.test','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,{waitUntil(p){jobs.push(p);}},path.split('?')[0],{sub:account});
const drain=async()=>{while(jobs.length)await Promise.all(jobs.splice(0));};
const balance=()=>db.prepare("SELECT credit_balance*10000+credit_remainder_micros AS n,billing_reserved_micros reserved FROM accounts WHERE id='fixture-a'").get();
const generate=async(body)=>{const r=await call('/chat/image','POST',body);const text=await r.text();await drain();return {r,text};};
try{
 const models=await(await call('/chat/models')).json();assert.equal(models.defaultImageModel,'gpt-image-2.5-sunburst');assert.ok(models.capabilities.imageGeneration);
 const convo=await(await call('/conversations','POST',{title:'图片'})).json(),base={conversationId:convo.id,content:'blue robot',size:'1024x1024',quality:'low'};
 const before=balance(),body={...base,requestId:crypto.randomUUID()},first=await generate(body);assert.equal(first.r.status,200);assert.match(first.text,/botgo.image.completed/);
 const event=first.text.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))).find(e=>e.type==='botgo.image.completed'),file=event.images[0];
 const charged=balance();assert.ok(charged.n<before.n);assert.equal(charged.reserved,0);assert.equal(runtime.media.size,1);
 assert.notEqual([...runtime.media.values()][0].subarray(0,8).toString(),[137,80,78,71,13,10,26,10].toString(),'R2 contains ciphertext only');
 const saved=await(await call('/conversations/'+convo.id)).json();assert.equal(saved.messages[1].kind,'image');assert.deepEqual(saved.messages[1].images,event.images);assert.equal(saved.messages[1].model,'gpt-image-2.5-sunburst');
 const png=await call('/chat/images/'+file.id);assert.equal(png.status,200);assert.equal(png.headers.get('content-type'),'image/png');assert.deepEqual([...new Uint8Array(await png.arrayBuffer()).slice(0,8)],[137,80,78,71,13,10,26,10]);
 assert.equal((await call('/chat/images/'+file.id,'GET',null,'fixture-b')).status,404);assert.match((await call('/chat/images/'+file.id+'?download=1')).headers.get('content-disposition'),/attachment/);
 assert.equal((await generate(body)).r.status,409);assert.equal(runtime.upstreamCalls.length,1);assert.deepEqual(balance(),charged,'replay cannot generate or charge again');
 const ledger=db.prepare('SELECT snapshot FROM metered_requests WHERE id LIKE ?').get('%'+body.requestId);assert.equal(JSON.parse(ledger.snapshot).billingModel,'gpt-image-2.5-sunburst');
 for(const mode of ['reject','image-no-usage','image-invalid']){runtime.setUpstreamMode(mode);const result=await generate({...base,requestId:crypto.randomUUID()});assert.match(result.text,/botgo.image.failed/);assert.deepEqual(balance(),charged);assert.equal(db.prepare("SELECT COUNT(*) n FROM upstream_leases WHERE state='active'").get().n,0);}
 runtime.setUpstreamMode('normal');const put=env.DESKTOP_RELEASES.put;env.DESKTOP_RELEASES.put=async()=>{throw Error('isolated storage failure');};const failed=await generate({...base,requestId:crypto.randomUUID()});assert.match(failed.text,/IMAGE_STORAGE_FAILED/);assert.deepEqual(balance(),charged);env.DESKTOP_RELEASES.put=put;
 runtime.setUpstreamMode('hold');const calls=runtime.upstreamCalls.length,cancelBody={...base,requestId:crypto.randomUUID()},stream=await call('/chat/image','POST',cancelBody),reader=stream.body.getReader();await reader.read();
 while(runtime.upstreamCalls.length===calls)await new Promise(resolve=>setTimeout(resolve,5));
 const cancelled=await call('/chat/cancel','POST',cancelBody);assert.equal((await cancelled.json()).state,'stopped');await reader.cancel();await drain();assert.deepEqual(balance(),charged);assert.equal(db.prepare('SELECT state FROM web_chat_turns WHERE request_id=?').get(cancelBody.requestId).state,'stopped');
 db.prepare("UPDATE web_chat_turns SET created_at=datetime('now','-31 days') WHERE request_id=?").run(body.requestId);assert.equal((await call('/chat/images/'+file.id)).status,404,'expired media is unreadable before physical cleanup');
 assert.equal((await call('/conversations/'+convo.id,'DELETE')).status,200);assert.equal(db.prepare('SELECT COUNT(*) n FROM web_chat_images').get().n,0);
 db.exec("UPDATE web_chat_image_gc SET created_at=datetime('now','-11 minutes')");await purgeWebChatImages(env);assert.equal(runtime.media.size,0);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 console.log('Web images: Admin route/price, encrypted storage, authenticated preview/download/history, replay protection, cancellation/refunds, leases, invalid output/storage failure and expiry GC passed');
}finally{await drain();runtime.close();}
