const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{16,128}$/.test(value);
async function recover(env,id) {
  await env.DB.prepare("UPDATE web_chat_turns SET state='stopped' WHERE conversation_id=? AND state='running' AND updated_at<datetime('now','-4 minutes')").bind(id).run();
}
async function owned(env,accountId,id) {
  return env.DB.prepare("SELECT * FROM web_conversations WHERE id=? AND account_id=? AND (created_at>datetime('now','-30 days') OR EXISTS(SELECT 1 FROM web_chat_turns WHERE conversation_id=web_conversations.id AND created_at>datetime('now','-30 days')))").bind(id,accountId).first();
}
export async function conversationRoute(request,env,accountId,path) {
  const match=path.match(/^\/conversations\/([a-zA-Z0-9_-]{16,128})$/);
  if(path!=='/conversations'&&!match)return null;
  if(!accountId)return json({error:'请先登录 BotGo。'},401);
  if(path==='/conversations') {
    if(request.method==='GET') {
      const offset=Math.max(0,Math.min(100000,Number(new URL(request.url).searchParams.get('offset'))||0));
      const rows=await env.DB.prepare("SELECT id,COALESCE((SELECT substr(content,1,40) FROM web_chat_turns WHERE conversation_id=web_conversations.id AND created_at>datetime('now','-30 days') ORDER BY rowid LIMIT 1),CASE WHEN created_at>datetime('now','-30 days') THEN title ELSE '新对话' END) AS title,updated_at FROM web_conversations WHERE account_id=? AND (created_at>datetime('now','-30 days') OR EXISTS(SELECT 1 FROM web_chat_turns WHERE conversation_id=web_conversations.id AND created_at>datetime('now','-30 days'))) ORDER BY updated_at DESC,rowid DESC LIMIT 51 OFFSET ?").bind(accountId,Math.floor(offset)).all();
      return json({conversations:rows.results.slice(0,50),hasMore:rows.results.length>50});
    }
    if(request.method==='POST') {
      const body=await request.json().catch(()=>null);
      if(typeof body?.title!=='string'||!body.title.trim())return json({error:'请输入第一条消息。'},400);
      const id=crypto.randomUUID(),title=Array.from(body.title.trim().replace(/\s+/g,' ')).slice(0,40).join('');
      await env.DB.prepare('INSERT INTO web_conversations(id,account_id,title) VALUES(?,?,?)').bind(id,accountId,title).run();
      return json({id,title},201);
    }
  } else {
    const id=match[1];const conversation=await owned(env,accountId,id);
    if(!conversation)return json({error:'对话不存在。'},404);
    await recover(env,id);
    if(request.method==='GET') {
      const rows=await env.DB.prepare("SELECT request_id,content,answer,model,state FROM web_chat_turns WHERE conversation_id=? AND created_at>datetime('now','-30 days') ORDER BY rowid").bind(id).all();
      return json({...conversation,title:rows.results[0]?.content.slice(0,40)||'新对话',messages:rows.results.flatMap(t=>[
        {role:'user',content:t.content,requestId:t.request_id},
        {role:'assistant',content:t.answer,model:t.model,state:t.state,requestId:t.request_id}
      ])});
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
export async function startConversationTurn(env,accountId,body) {
  if(!validId(body.conversationId)||!validId(body.requestId)||typeof body.content!=='string'||!body.content.trim()||body.content.length>100000)
    return {response:json({error:'对话请求不完整或消息过长。'},400)};
  if(!await owned(env,accountId,body.conversationId))return {response:json({error:'对话不存在。'},404)};
  await recover(env,body.conversationId);
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO web_chat_turns(request_id,conversation_id,content,model) VALUES(?,?,?,?)').bind(body.requestId,body.conversationId,body.content.trim(),body.model),
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
    if(choice?.finish_reason)terminal=true;
    if(answer.length>4000000)throw new Error('RESPONSE_TOO_LARGE');
  };
  const history={
    async push(bytes){buffer+=decoder.decode(bytes,{stream:true});let at;while((at=buffer.indexOf('\n'))>=0){line(buffer.slice(0,at).replace(/\r$/,''));buffer=buffer.slice(at+1);}if(buffer.length>2*1024*1024)throw new Error('SSE_FRAME_TOO_LARGE');if(Date.now()-lastSave>1000)await save();},
    async finish(state){buffer+=decoder.decode();try{if(buffer)line(buffer);}catch{state='failed';}buffer='';await save(state==='completed'&&!terminal?'stopped':state);},
    async result(result){answer=result.choices?.[0]?.message?.content||'';terminal=true;await save('completed');}
  };
  try {
    const rows=await env.DB.prepare("SELECT content,answer FROM web_chat_turns WHERE conversation_id=? AND request_id<>? AND state IN ('completed','stopped') AND created_at>datetime('now','-30 days') ORDER BY rowid").bind(body.conversationId,body.requestId).all();
    const messages=rows.results.flatMap(t=>[{role:'user',content:t.content},...(t.answer?[{role:'assistant',content:t.answer}]:[])]);
    messages.push({role:'user',content:body.content.trim()});
    return {history,body:{model:body.model,messages}};
  }catch(error){await save('failed');throw error;}
}

export async function purgeExpiredConversations(env) {
 let removed=0;
 for(let batch=0;batch<10;batch++) {
  const result=await env.DB.prepare("DELETE FROM web_chat_turns WHERE request_id IN (SELECT request_id FROM web_chat_turns WHERE created_at<=datetime('now','-30 days') ORDER BY created_at LIMIT 200)").run();
  removed+=result.meta.changes;
  if(result.meta.changes<200)break;
 }
 await env.DB.prepare("DELETE FROM web_conversations WHERE id IN (SELECT id FROM web_conversations WHERE NOT EXISTS(SELECT 1 FROM web_chat_turns WHERE conversation_id=web_conversations.id) AND created_at<=datetime('now','-30 days') LIMIT 2000)").run();
 await env.DB.prepare("UPDATE web_conversations SET title=COALESCE((SELECT substr(content,1,40) FROM web_chat_turns WHERE conversation_id=web_conversations.id AND created_at>datetime('now','-30 days') ORDER BY rowid LIMIT 1),'新对话') WHERE id IN (SELECT id FROM web_conversations WHERE created_at<=datetime('now','-30 days') AND title<>COALESCE((SELECT substr(content,1,40) FROM web_chat_turns WHERE conversation_id=web_conversations.id AND created_at>datetime('now','-30 days') ORDER BY rowid LIMIT 1),'新对话') LIMIT 2000)").run();
 console.log(JSON.stringify({event:'web_history_cleanup',removed}));
 return {removed};
}
