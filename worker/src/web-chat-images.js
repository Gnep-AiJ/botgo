// Private media uses a dedicated encrypted prefix in the existing R2 binding.
// The public desktop-release namespace and its contents are never changed.
const webMediaPrefix='web-chat/media-v1/';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const decode=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function mediaKey(env){
 const raw=decode(env.UPSTREAM_CONFIG_KEY),key=await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new TextEncoder().encode('BotGo'),info:new TextEncoder().encode('web-chat-media-v1')},key,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
const aad=(account,id)=>new TextEncoder().encode(JSON.stringify([account,id]));
export async function saveGeneratedImage(env,accountId,body,{result,cost,id,model,signal}){
 const encoded=result.data[0].b64_json;
 if(typeof encoded!=='string'||encoded.length>16*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw Error('INVALID_IMAGE');
 const bytes=decode(encoded);
 if(bytes.length<24||bytes.length>12*1024*1024||[137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n))throw Error('INVALID_PNG');
 const dimensions=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if([73,72,68,82].some((n,i)=>bytes[i+12]!==n)||dimensions.getUint32(16)<1||dimensions.getUint32(20)<1||dimensions.getUint32(16)>4096||dimensions.getUint32(20)>4096)throw Error('INVALID_PNG_SIZE');
 const fileId=crypto.randomUUID(),storageKey=webMediaPrefix+fileId+'.bin',iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(accountId,fileId)},await mediaKey(env),bytes);
 signal.throwIfAborted();
 // A pending cleanup record also covers crashes between R2 and D1 writes.
 await env.DB.prepare('INSERT INTO web_chat_image_gc(storage_key) VALUES(?)').bind(storageKey).run();
 const stored=await env.DESKTOP_RELEASES.put(storageKey,ciphertext,{httpMetadata:{contentType:'application/octet-stream'}});
 if(!stored)throw Error('MEDIA_WRITE_FAILED');
 signal.throwIfAborted();
 await env.DB.batch([
  env.DB.prepare("INSERT INTO web_chat_images(id,request_id,account_id,storage_key,iv,bytes) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM web_chat_turns WHERE request_id=? AND conversation_id=? AND state='running') AND EXISTS(SELECT 1 FROM metered_requests WHERE id=? AND state='reserved') AND NOT EXISTS(SELECT 1 FROM web_chat_cancellations WHERE request_id=?)").bind(fileId,body.requestId,accountId,storageKey,btoa(String.fromCharCode(...iv)),bytes.length,body.requestId,body.conversationId,id,body.requestId),
  env.DB.prepare("UPDATE metered_requests SET state='completed',cost_micros=?,usage_json=?,review_reason=NULL,review_required=0 WHERE id=? AND state='reserved' AND EXISTS(SELECT 1 FROM web_chat_images WHERE id=?)").bind(cost,JSON.stringify(result.usage),id,fileId),
  env.DB.prepare("UPDATE web_chat_turns SET answer='图片已生成',model=?,state='completed',updated_at=CURRENT_TIMESTAMP WHERE request_id=? AND state='running' AND EXISTS(SELECT 1 FROM metered_requests WHERE id=? AND state='completed')").bind(model,body.requestId,id),
  env.DB.prepare('DELETE FROM web_chat_image_gc WHERE storage_key=? AND EXISTS(SELECT 1 FROM web_chat_images WHERE id=?)').bind(storageKey,fileId)
 ]);
 const saved=await env.DB.prepare('SELECT id FROM web_chat_images WHERE id=?').bind(fileId).first();
 if(!saved){await env.DESKTOP_RELEASES.delete(storageKey);await env.DB.prepare('DELETE FROM web_chat_image_gc WHERE storage_key=?').bind(storageKey).run();throw new DOMException('Cancelled','AbortError');}
 return json({model,images:[{id:fileId,url:'/api/chat/images/'+fileId}],content:'图片已生成'});
}
export async function imageResponse(request,env,accountId,fileId){
 const image=await env.DB.prepare("SELECT i.* FROM web_chat_images i JOIN web_chat_turns t ON t.request_id=i.request_id JOIN web_conversations c ON c.id=t.conversation_id WHERE i.id=? AND i.account_id=? AND c.account_id=? AND t.state='completed' AND t.created_at>datetime('now','-30 days')").bind(fileId,accountId,accountId).first();
 if(!image||!image.storage_key.startsWith(webMediaPrefix))return json({error:'图片不存在或已过期。'},404);
 try{
  const object=await env.DESKTOP_RELEASES.get(image.storage_key);
  if(!object)return json({error:'图片暂不可用，请稍后重试。'},404);
  if(object.size>12*1024*1024+16)throw Error('INVALID_SIZE');
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(image.iv),additionalData:aad(accountId,fileId)},await mediaKey(env),await object.arrayBuffer());
  if(bytes.byteLength!==image.bytes)throw Error('INVALID_SIZE');
  return new Response(bytes,{headers:{'content-type':'image/png','cache-control':'private, no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin',...(new URL(request.url).searchParams.get('download')==='1'?{'content-disposition':`attachment; filename="BotGo-${fileId}.png"`}:{})}});
 }catch{return json({error:'图片读取失败，请稍后重试。'},503);}
}
export async function purgeWebChatImages(env){
 if(!env.DESKTOP_RELEASES)return;
 const rows=(await env.DB.prepare("SELECT storage_key FROM web_chat_image_gc WHERE created_at<datetime('now','-10 minutes') AND NOT EXISTS(SELECT 1 FROM web_chat_images WHERE storage_key=web_chat_image_gc.storage_key) LIMIT 100").all()).results||[];
 for(const row of rows){if(!row.storage_key.startsWith(webMediaPrefix))continue;await env.DESKTOP_RELEASES.delete(row.storage_key);await env.DB.prepare('DELETE FROM web_chat_image_gc WHERE storage_key=?').bind(row.storage_key).run();}
 return {removed:rows.length};
}
