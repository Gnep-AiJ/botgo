import { SPECIALTIES, specialtyContext, specialtyPrompt } from './web-specialties.js';
import { SEARCH_INSTRUCTIONS, citedAnswer } from './web-search.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{16,128}$/.test(value);
async function recover(env,id) {
  await env.DB.prepare("UPDATE web_chat_turns SET state='stopped' WHERE conversation_id=? AND state='running' AND updated_at<datetime('now','-4 minutes')").bind(id).run();
}
async function owned(env,accountId,id) {
  return env.DB.prepare("SELECT * FROM web_conversations WHERE id=? AND account_id=? AND (created_at>datetime('now','-30 days') OR EXISTS(SELECT 1 FROM web_chat_turns WHERE conversation_id=web_conversations.id AND created_at>datetime('now','-30 days')))").bind(id,accountId).first();
}
export async function cancelConversationTurn(env,accountId,body) {
  if(!validId(body?.conversationId)||!validId(body?.requestId))return json({error:'请求标识无效。'},400);
  if(!await owned(env,accountId,body.conversationId))return json({error:'对话不存在。'},404);
  const existing=await env.DB.prepare('SELECT conversation_id,state FROM web_chat_turns WHERE request_id=?').bind(body.requestId).first();
  if(existing&&existing.conversation_id!==body.conversationId)return json({error:'请求不存在。'},404);
  const id=`${accountId}:web_chat:${body.requestId}`;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO web_chat_cancellations(request_id,account_id,conversation_id) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM metered_requests WHERE id=? AND state='completed') AND NOT EXISTS(SELECT 1 FROM web_chat_turns WHERE request_id=? AND state='completed') AND (EXISTS(SELECT 1 FROM web_chat_turns WHERE request_id=?) OR (SELECT COUNT(*) FROM web_chat_cancellations WHERE account_id=? AND created_at>datetime('now','-1 hour'))<64)").bind(body.requestId,accountId,body.conversationId,id,body.requestId,body.requestId,accountId),
    env.DB.prepare("UPDATE web_chat_turns SET state='stopped',updated_at=CURRENT_TIMESTAMP WHERE request_id=? AND conversation_id=? AND state='running' AND EXISTS(SELECT 1 FROM web_chat_cancellations WHERE request_id=?)").bind(body.requestId,body.conversationId,body.requestId),
    env.DB.prepare("UPDATE metered_requests SET state='refunded',cost_micros=0,review_reason='client_cancelled',review_required=0 WHERE account_id=? AND channel='web_chat' AND (id=? OR json_extract(snapshot,'$.webTurnId')=?) AND state='reserved' AND EXISTS(SELECT 1 FROM web_chat_cancellations WHERE request_id=?)").bind(accountId,id,body.requestId,body.requestId),
    env.DB.prepare("UPDATE upstream_leases SET state='released',released_at=CURRENT_TIMESTAMP WHERE request_id IN (SELECT id FROM metered_requests WHERE account_id=? AND channel='web_chat' AND (id=? OR json_extract(snapshot,'$.webTurnId')=?)) AND state='active' AND EXISTS(SELECT 1 FROM web_chat_cancellations WHERE request_id=?)").bind(accountId,id,body.requestId,body.requestId)
  ]);
  const cancelled=await env.DB.prepare('SELECT request_id FROM web_chat_cancellations WHERE request_id=? AND account_id=? AND conversation_id=?').bind(body.requestId,accountId,body.conversationId).first();
  if(cancelled)return json({state:'stopped'});
  if(existing)return json({state:existing.state==='running'?'completed':existing.state});
  return json({error:'停止请求过于频繁，请稍后重试。'},429);
}
export async function conversationRoute(request,env,accountId,path) {
  const match=path.match(/^\/conversations\/([a-zA-Z0-9_-]{16,128})$/);
  if(path!=='/conversations'&&!match)return null;
  if(!accountId)return json({error:'请先登录 BotGo。'},401);
  if(path==='/conversations') {
    if(request.method==='GET') {
      const topic=new URL(request.url).searchParams.get('topic');
      if(topic!==null&&!Object.hasOwn(SPECIALTIES,topic))return json({error:'领域无效。'},400);
      const offset=Math.max(0,Math.min(100000,Number(new URL(request.url).searchParams.get('offset'))||0));
      const rows=await env.DB.prepare("SELECT id,topic,CASE WHEN renamed_at>datetime('now','-30 days') THEN title ELSE COALESCE((SELECT substr(content,1,40) FROM web_chat_turns WHERE conversation_id=web_conversations.id AND created_at>datetime('now','-30 days') ORDER BY rowid LIMIT 1),CASE WHEN created_at>datetime('now','-30 days') THEN title ELSE '新对话' END) END AS title,updated_at FROM web_conversations WHERE account_id=? AND (? IS NULL OR topic=?) AND (created_at>datetime('now','-30 days') OR EXISTS(SELECT 1 FROM web_chat_turns WHERE conversation_id=web_conversations.id AND created_at>datetime('now','-30 days'))) ORDER BY updated_at DESC,rowid DESC LIMIT 51 OFFSET ?").bind(accountId,topic,topic,Math.floor(offset)).all();
      return json({conversations:rows.results.slice(0,50),hasMore:rows.results.length>50});
    }
    if(request.method==='POST') {
      const body=await request.json().catch(()=>null);
      if(typeof body?.title!=='string'||!body.title.trim())return json({error:'请输入第一条消息。'},400);
      const topic=body.topic??'general';
      if(typeof topic!=='string'||!Object.hasOwn(SPECIALTIES,topic))return json({error:'领域无效。'},400);
      const id=crypto.randomUUID(),title=Array.from(body.title.trim().replace(/\s+/g,' ')).slice(0,40).join('');
      const context=specialtyContext(topic);
      await env.DB.prepare('INSERT INTO web_conversations(id,account_id,title,topic,context_json) VALUES(?,?,?,?,?)').bind(id,accountId,title,topic,JSON.stringify(context)).run();
      return json({id,title,topic,context},201);
    }
  } else {
    const id=match[1];const conversation=await owned(env,accountId,id);
    if(!conversation)return json({error:'对话不存在。'},404);
    await recover(env,id);
    if(request.method==='GET') {
      const rows=await env.DB.prepare("SELECT request_id,content,answer,model,state,kind,params_json,error_code FROM web_chat_turns WHERE conversation_id=? AND created_at>datetime('now','-30 days') ORDER BY rowid").bind(id).all();
      const images=(await env.DB.prepare("SELECT i.id,i.request_id FROM web_chat_images i JOIN web_chat_turns t ON t.request_id=i.request_id WHERE t.conversation_id=? AND t.created_at>datetime('now','-30 days')").bind(id).all()).results;
      const imagesByTurn=new Map();for(const image of images){if(!imagesByTurn.has(image.request_id))imagesByTurn.set(image.request_id,[]);imagesByTurn.get(image.request_id).push({id:image.id,url:'/api/chat/images/'+image.id});}
      const {context_json,...publicConversation}=conversation;
      const recentRename=conversation.renamed_at&&conversation.renamed_at>new Date(Date.now()-30*86400000).toISOString().replace('T',' ').slice(0,19);
      return json({...publicConversation,context:JSON.parse(context_json),title:recentRename?conversation.title:Array.from(rows.results[0]?.content||conversation.title).slice(0,40).join(''),messages:rows.results.flatMap(t=>[
        {role:'user',content:t.content,requestId:t.request_id},
        {role:'assistant',content:t.answer,model:t.model,state:t.state,requestId:t.request_id,...(t.kind==='image'?{kind:'image',params:JSON.parse(t.params_json),images:imagesByTurn.get(t.request_id)||[]}:{}),...(t.error_code?{errorCode:t.error_code}:{})}
      ])});
    }
    if(request.method==='PATCH') {
      const body=await request.json().catch(()=>null);
      const title=typeof body?.title==='string'?body.title.trim().replace(/\s+/g,' '):'';
      if(!title||Array.from(title).length>40)return json({error:'标题请填写 1–40 个字。'},400);
      const result=await env.DB.prepare('UPDATE web_conversations SET title=?,renamed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=?').bind(title,id,accountId).run();
      return result.meta.changes?json({id,title}):json({error:'对话不存在。'},404);
    }
    if(request.method==='DELETE') {
      const result=await env.DB.prepare("DELETE FROM web_conversations WHERE id=? AND account_id=? AND NOT EXISTS(SELECT 1 FROM web_chat_turns WHERE conversation_id=? AND state='running')").bind(id,accountId,id).run();
      if(!result.meta.changes)return json({error:'请先停止生成，稍后再删除。'},409);
      return json({ok:true});
    }
  }
  return json({error:'不支持此操作。'},405);
}

// Own the context and persistence on the server; never accept another account's messages.
export async function startConversationTurn(env,accountId,body,{kind='chat',params={}}={}) {
  if(!validId(body.conversationId)||!validId(body.requestId)||typeof body.content!=='string'||!body.content.trim()||body.content.length>100000)
    return {response:json({error:'对话请求不完整或消息过长。'},400)};
  const conversation=await owned(env,accountId,body.conversationId);
  if(!conversation)return {response:json({error:'对话不存在。'},404)};
  const cancelled=async()=>!!await env.DB.prepare('SELECT request_id FROM web_chat_cancellations WHERE request_id=? AND account_id=? AND conversation_id=?').bind(body.requestId,accountId,body.conversationId).first();
  if(await cancelled())return {response:json({error:'请求已停止。',code:'CANCELLED'},499)};
  const size=await env.DB.prepare("SELECT COALESCE(SUM(length(CAST(content AS BLOB))+length(CAST(answer AS BLOB))),0) AS bytes,COUNT(*) AS turns FROM web_chat_turns WHERE conversation_id=? AND state IN ('completed','stopped') AND created_at>datetime('now','-30 days')").bind(body.conversationId).first();
  if(size.bytes+size.turns*128+new TextEncoder().encode(body.content).length+8192>1000000)return {response:json({error:'上下文过长，请新建对话。'},413)};
  await recover(env,body.conversationId);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO web_chat_turns(request_id,conversation_id,content,model,kind,params_json) VALUES(?,?,?,?,?,?)').bind(body.requestId,body.conversationId,body.content.trim(),body.model,kind,JSON.stringify(params)),
      env.DB.prepare('UPDATE web_conversations SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND account_id=?').bind(body.conversationId,accountId)
    ]);
  } catch(error) {
    if(/CONVERSATION_BUSY|UNIQUE/.test(String(error)))return {response:json({error:'该对话正在生成或此请求已经受理，请刷新历史记录。'},409)};
    throw error;
  }
  let answer='',buffer='',lastSave=0,terminal=false;
  const decoder=new TextDecoder();
  const save=async(state='running')=>{
    await env.DB.batch([
      env.DB.prepare("UPDATE web_chat_turns SET answer=?,state=?,updated_at=CURRENT_TIMESTAMP WHERE request_id=? AND state='running'").bind(answer,state,body.requestId),
      env.DB.prepare('UPDATE web_conversations SET updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(body.conversationId)
    ]);lastSave=Date.now();
  };
  const line=value=>{
    if(!value.startsWith('data:'))return;
    const text=value.slice(5).trim();if(text==='[DONE]'){terminal=true;return;}
    if(!text)return;
    const item=JSON.parse(text),choice=item.choices?.[0];
    if(typeof choice?.delta?.content==='string')answer+=choice.delta.content;
    if(item.type==='response.output_text.delta'&&typeof item.delta==='string')answer+=item.delta;
    if(item.type==='response.completed'){
      const result=item.response;
      answer=citedAnswer(answer||result?.output_text||result?.output?.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('')||'',result);
    }
    if(choice?.finish_reason||['response.completed','response.failed','response.incomplete'].includes(item.type))terminal=true;
    if(answer.length>4000000)throw new Error('RESPONSE_TOO_LARGE');
  };
  const history={
    cancelled,
    hasAnswer:()=>!!answer.trim(),
    validateResult:result=>!!String(result.choices?.[0]?.message?.content||result.output_text||result.output?.flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text).join('')||'').trim(),
    async push(bytes){buffer+=decoder.decode(bytes,{stream:true});let at;while((at=buffer.indexOf('\n'))>=0){line(buffer.slice(0,at).replace(/\r$/,''));buffer=buffer.slice(at+1);}if(buffer.length>2*1024*1024)throw new Error('SSE_FRAME_TOO_LARGE');if(Date.now()-lastSave>1000)await save();},
    async finish(state){buffer+=decoder.decode();try{if(buffer)line(buffer);}catch{state='failed';}buffer='';await save(state==='completed'&&!terminal?'stopped':state);},
    async result(result){answer=citedAnswer(result.choices?.[0]?.message?.content||result.output_text||result.output?.flatMap(item=>item.content||[]).filter(item=>item.type==='output_text').map(item=>item.text).join('')||'',result);terminal=true;await save('completed');}
  };
  try {
    const rows=await env.DB.prepare("SELECT content,answer,kind,params_json FROM web_chat_turns WHERE conversation_id=? AND request_id<>? AND state IN ('completed','stopped') AND created_at>datetime('now','-30 days') ORDER BY rowid").bind(body.conversationId,body.requestId).all();
    const prompt=specialtyPrompt(conversation.topic,JSON.parse(conversation.context_json))+(body.web_search===true?'\n'+SEARCH_INSTRUCTIONS:'');
    const messages=[{role:'system',content:prompt},...rows.results.flatMap(t=>[{role:'user',content:t.content},...(t.answer?[{role:'assistant',content:t.answer+(t.kind==='image'&&JSON.parse(t.params_json).prompt?'\n生成图片描述：'+JSON.parse(t.params_json).prompt:'')}]:[])])];
    messages.push({role:'user',content:body.content.trim()});
    return {history,body:{model:body.model,messages}};
  }catch(error){await save('failed');throw error;}
}

export async function purgeExpiredConversations(env) {
 await env.DB.prepare("DELETE FROM web_chat_cancellations WHERE request_id IN (SELECT request_id FROM web_chat_cancellations WHERE created_at<=datetime('now','-30 days') LIMIT 2000)").run();
 let removed=0;
 for(let batch=0;batch<10;batch++) {
  const result=await env.DB.prepare("DELETE FROM web_chat_turns WHERE request_id IN (SELECT request_id FROM web_chat_turns WHERE created_at<=datetime('now','-30 days') ORDER BY created_at LIMIT 200)").run();
  removed+=result.meta.changes;
  if(result.meta.changes<200)break;
 }
 await env.DB.prepare("DELETE FROM web_conversations WHERE id IN (SELECT id FROM web_conversations WHERE NOT EXISTS(SELECT 1 FROM web_chat_turns WHERE conversation_id=web_conversations.id) AND created_at<=datetime('now','-30 days') LIMIT 2000)").run();
 await env.DB.prepare("UPDATE web_conversations SET title=COALESCE((SELECT substr(content,1,40) FROM web_chat_turns WHERE conversation_id=web_conversations.id AND created_at>datetime('now','-30 days') ORDER BY rowid LIMIT 1),'新对话'),renamed_at=NULL WHERE id IN (SELECT id FROM web_conversations WHERE (renamed_at IS NULL OR renamed_at<=datetime('now','-30 days')) AND ((created_at<=datetime('now','-30 days') AND title<>COALESCE((SELECT substr(content,1,40) FROM web_chat_turns WHERE conversation_id=web_conversations.id AND created_at>datetime('now','-30 days') ORDER BY rowid LIMIT 1),'新对话')) OR renamed_at IS NOT NULL) LIMIT 2000)").run();
 console.log(JSON.stringify({event:'web_history_cleanup',removed}));
 return {removed};
}
