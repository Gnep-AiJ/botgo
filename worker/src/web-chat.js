import { agentRoutes, availableAgentRoutes, resolveAgentCandidates, imageModelRoutes, handleImageGeneration } from './opencode-gateway.js';
import { catalog, meteredProxy } from './metering.js';
import { conversationRoute, startConversationTurn, cancelConversationTurn } from './conversations.js';
import { supportsWebSearch } from './web-search.js';
import { imageResponse, saveGeneratedImage } from './web-chat-images.js';
import { IMAGE_TOOL, imageToolHistory, selectionRequestId } from './web-chat-tools.js';
import { chatAttachmentPreview, supportsWebChatVision, WEB_CHAT_ATTACHMENT_BODY_LIMIT } from './web-chat-attachments.js';
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});
const textBodyLimit=1000000;
function imageError(code){return {UPSTREAM_REJECTED:'生图服务未接受请求，请修改描述后重试',MISSING_IMAGE_USAGE:'生图服务返回不完整，请稍后重试',IMAGE_USAGE_LIMIT:'图片生成未完成，请降低质量后重试',IMAGE_STORAGE_FAILED:'图片保存失败，请稍后重试',REQUEST_UNCERTAIN:'连接中断，请先刷新对话确认结果',UPSTREAM_TIMEOUT:'生成超时，请稍后重试',BILLING_INSUFFICIENT:'请到账户查看余额',REQUEST_EXISTS:'请求已受理，请刷新对话',UPSTREAM_CAPACITY_LIMIT:'生图服务繁忙，请稍后重试',ACCOUNT_CONCURRENCY_LIMIT:'当前任务较多，请稍后重试'}[code]||'图片生成未完成，请稍后重试';}

async function boundedBody(request,maxBytes=textBodyLimit){
  const reader=request.body?.getReader();
  if(!reader)return null;
  const chunks=[];let length=0;
  for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>maxBytes){await reader.cancel();throw new Error('BODY_TOO_LARGE');}chunks.push(value);}
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body=null;
  try{body=JSON.parse(new TextDecoder().decode(bytes));}catch{}
  if(length>textBodyLimit&&!(Array.isArray(body?.attachments)&&body.attachments.length))throw new Error('BODY_TOO_LARGE');
  return body;
}

export async function handleWebChat(request,env,ctx,path,identity){
  const isConversation=path==='/conversations'||/^\/conversations\/[a-zA-Z0-9_-]{16,128}$/.test(path);
  const image=path.match(/^\/chat\/images\/([a-zA-Z0-9_-]{16,128})$/);
  const attachment=path.match(/^\/chat\/attachments\/([a-zA-Z0-9_-]{16,128})\/([0-3])$/);
  if(!isConversation&&!image&&!attachment&&!['/chat/models','/chat/stream','/chat/image','/chat/cancel','/chat/usage'].includes(path))return null;
  if(!identity?.sub)return json({error:'请先登录 BotGo。'},401);
  if(!['GET','HEAD'].includes(request.method)){
    const origin=request.headers.get('origin');
    if((origin&&origin!==new URL(request.url).origin)||request.headers.get('sec-fetch-site')==='cross-site')return json({error:'请求来源无效。'},403);
  }
  try{
    if(image&&request.method==='GET')return await imageResponse(request,env,identity.sub,image[1]);
    if(attachment&&request.method==='GET')return await chatAttachmentPreview(env,identity.sub,attachment[1],Number(attachment[2]));
    if(path==='/chat/image'&&request.method==='POST'){
      if(!env.DESKTOP_RELEASES)return json({error:'图片存储暂不可用。'},503);
      if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'需要 JSON 请求。'},415);
      const body=await boundedBody(request);
      if(!body||typeof body.content!=='string'||!body.content.trim()||body.content.length>8192||body.model!==undefined||body.tools!==undefined)return json({error:'请描述想生成的图片，最多 8192 字符。'},400);
      const params={size:body.size??'1024x1024',quality:body.quality??'medium'};
      if(!['1024x1024','1536x1024','1024x1536'].includes(params.size)||!['low','medium','high'].includes(params.quality))return json({error:'图片尺寸或质量无效。'},400);
      const model=(await env.DB.prepare('SELECT default_image_model FROM metering_settings WHERE id=1').first())?.default_image_model;
      if(!(await imageModelRoutes(env)).some(r=>r.model_id===model))return json({error:'生图模型暂不可用。'},503);
      body.model=model;
      const turn=await startConversationTurn(env,identity.sub,body,{kind:'image',params});
      if(turn.response)return turn.response;
      const abort=new AbortController(),signal=AbortSignal.any([request.signal,abort.signal]);
      const encoder=new TextEncoder();let streamController,closed=false;
      const emit=body=>{if(!closed)streamController.enqueue(encoder.encode('data: '+JSON.stringify(body)+'\n\n'));};
      const stream=new ReadableStream({start(c){streamController=c;emit({type:'botgo.image.generating',model});},cancel(){closed=true;abort.abort();}});
      const heartbeat=setInterval(()=>emit({type:'botgo.image.generating',model}),5000);
      const job=(async()=>{
        try{
          const imageRequest=new Request(request.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:body.content,model,...params}),signal});
          const response=await handleImageGeneration(imageRequest,env,{account_id:identity.sub},{channel:'web_chat',requestId:body.requestId,taskId:body.conversationId,history:turn.history,complete:result=>saveGeneratedImage(env,identity.sub,body,result)});
          const result=await response.json();
          if(!response.ok){await env.DB.prepare("UPDATE web_chat_turns SET error_code=? WHERE request_id=? AND state='running'").bind(result.code||'IMAGE_FAILED',body.requestId).run();await turn.history.finish(result.code==='CANCELLED'?'stopped':'failed');emit({type:'botgo.image.failed',error:result.code==='CANCELLED'?'已停止':imageError(result.code),code:result.code});}
          else emit({type:'botgo.image.completed',...result});
        }catch{await turn.history.finish(signal.aborted?'stopped':'failed');emit({type:'botgo.image.failed',error:signal.aborted?'已停止':'图片生成未完成，请刷新对话后重试'});}
        finally{clearInterval(heartbeat);if(!closed){closed=true;streamController.close();}}
      })();ctx.waitUntil(job);
      return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-store'}});
    }
    if(path==='/chat/cancel'&&request.method==='POST'){
      if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'需要 JSON 请求。'},415);
      return await cancelConversationTurn(env,identity.sub,await boundedBody(request));
    }
    if(isConversation){
      if(['POST','PATCH'].includes(request.method)){
        if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'需要 JSON 请求。'},415);
        const body=await boundedBody(request);
        if(!body)return json({error:'请求无效。'},400);
        request=new Request(request.url,{method:request.method,headers:request.headers,body:JSON.stringify(body),signal:request.signal});
      }
      return await conversationRoute(request,env,identity.sub,path);
    }
    if(path==='/chat/usage'&&request.method==='GET'){
      const id=new URL(request.url).searchParams.get('conversationId');
      if(!/^[a-zA-Z0-9_-]{16,128}$/.test(id||''))return json({error:'对话标识无效。'},400);
      const rows=await env.DB.prepare("SELECT id,state,charged_micros,review_reason FROM metered_requests WHERE account_id=? AND channel='web_chat' AND json_extract(snapshot,'$.taskId')=? ORDER BY created_at DESC LIMIT 200").bind(identity.sub,id).all();
      return json({requests:rows.results||[]});
    }
    if(path==='/chat/models'&&request.method==='GET'){
      const [routes,data,cache]=await Promise.all([agentRoutes(env),catalog(env),env.DESKTOP_RELEASES?env.DB.prepare('SELECT model_id,model_json FROM official_model_cache').all():{results:[]}]);
      const knownModels=new Map(cache.results.map(row=>[row.model_id,JSON.parse(row.model_json)]));
      const models=await Promise.all(availableAgentRoutes(routes).map(async r=>{
        const candidates=await resolveAgentCandidates(env,r);
        return {id:r.model_id,name:r.name,protocol:r.protocol,webSearch:candidates.some(c=>supportsWebSearch(c,r)),attachments:!!env.DESKTOP_RELEASES&&candidates.length>0&&supportsWebChatVision(r.model_id,knownModels.get(r.model_id))};
      }));
      const withAttachments=models.filter(m=>m.attachments),preferred=withAttachments.length?withAttachments:models;
      const configured=preferred.find(m=>m.id===data.settings.default_model);
      const initial=configured?.webSearch?configured:preferred.find(m=>m.webSearch)||configured||preferred[0];
      const imageModels=env.DESKTOP_RELEASES?(await imageModelRoutes(env)).map(r=>({id:r.model_id,name:r.name})):[];
      const defaultImageModel=imageModels.some(r=>r.id===data.settings.default_image_model)?data.settings.default_image_model:'';
      return json({models,defaultModel:initial?.id||'',imageModels,defaultImageModel,capabilities:{webSearch:models.some(m=>m.webSearch),imageGeneration:!!defaultImageModel}});
    }
    if(path!=='/chat/stream'||request.method!=='POST')return json({error:'不支持此操作。'},405);
    if(!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'需要 JSON 请求。'},415);
    const body=await boundedBody(request,WEB_CHAT_ATTACHMENT_BODY_LIMIT);
    if(!body||typeof body.model!=='string')return json({error:'请求不完整。'},400);
    if(body.tools!==undefined||body.background||body.previous_response_id)return json({error:'不支持自定义托管工具或上游会话。'},400);
    if(body.web_search!==undefined&&typeof body.web_search!=='boolean')return json({error:'联网选项无效。'},400);
    const route=availableAgentRoutes(await agentRoutes(env)).find(r=>r.model_id===body.model);
    if(!route)return json({error:'所选模型暂不可用。'},503);
    let candidates=await resolveAgentCandidates(env,route);
    if(!candidates.length)return json({error:'上游配置不可用。'},503);
    const searchCandidates=candidates.filter(c=>supportsWebSearch(c,route));
    const nativeSearch=body.web_search!==false&&searchCandidates.length>0;
    if(body.web_search===true&&!nativeSearch)return json({error:'此模型暂不支持联网。'},400);
    if(nativeSearch)candidates=searchCandidates;
    body.web_search=nativeSearch;
    const cached=env.DESKTOP_RELEASES&&await env.DB.prepare('SELECT model_json FROM official_model_cache WHERE model_id=?').bind(route.model_id).first();
    const vision=supportsWebChatVision(route.model_id,cached&&JSON.parse(cached.model_json));
    const turn=await startConversationTurn(env,identity.sub,body,{vision,signal:request.signal});
    if(turn.response)return turn.response;
    const configuredImage=(await env.DB.prepare('SELECT default_image_model FROM metering_settings WHERE id=1').first())?.default_image_model;
    const imageEnabled=env.DESKTOP_RELEASES&&(await imageModelRoutes(env)).some(r=>r.model_id===configuredImage);
    if(imageEnabled){
      // Keep one user turn open across model selection and image generation. Text
      // selection uses its own deterministic ledger ID; the image keeps the parent
      // ID so existing atomic image persistence and cancellation remain applicable.
      const tool=imageToolHistory(turn.history),abort=new AbortController(),signal=AbortSignal.any([request.signal,abort.signal]);
      const encoder=new TextEncoder();let streamController,closed=false;
      const emit=value=>{if(!closed)streamController.enqueue(encoder.encode('data: '+JSON.stringify(value)+'\n\n'));};
      const stream=new ReadableStream({start(c){streamController=c;emit({type:'botgo.turn.started'});},cancel(){closed=true;abort.abort();}});
      const heartbeat=setInterval(()=>{if(!closed){streamController.enqueue(encoder.encode(': keepalive\n\n'));ctx.waitUntil(env.DB.prepare("UPDATE web_chat_turns SET updated_at=CURRENT_TIMESTAMP WHERE request_id=? AND state='running'").bind(body.requestId).run().catch(()=>{}));}},5000);
      const job=(async()=>{
        try{
          const headers=new Headers(request.headers);headers.set('idempotency-key',await selectionRequestId(body.requestId));
          const response=await meteredProxy(new Request(request.url,{method:'POST',headers,signal}),env,ctx,{accountId:identity.sub,channel:'web_chat',body:turn.body,candidates,agentRoute:route,history:tool.history,taskId:body.conversationId,webTurnId:body.requestId,nativeWebSearch:body.web_search===true,imageTool:IMAGE_TOOL});
          if(!response.ok){const result=await response.json();await turn.history.finish(response.status===499?'stopped':'failed');emit({error:result.error||'回答未完成'});return;}
          if(response.headers.get('content-type')?.includes('text/event-stream')){
            const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;signal.throwIfAborted();if(!closed)streamController.enqueue(value);}}finally{reader.releaseLock();}
          }else{const result=await response.json();emit({type:'response.completed',response:{...result,output_text:result.output_text||result.choices?.[0]?.message?.content||''}});}
          if(!tool.done())throw Error('INCOMPLETE_TURN');
          const params=tool.selected();
          if(!params){emit({type:'botgo.turn.completed'});return;}
          if(await turn.history.cancelled())throw new DOMException('Cancelled','AbortError');
          await env.DB.prepare("UPDATE web_chat_turns SET kind='image',params_json=?,updated_at=CURRENT_TIMESTAMP WHERE request_id=? AND state='running'").bind(JSON.stringify(params),body.requestId).run();
          emit({type:'botgo.image.generating'});
          const imageRequest=new Request(request.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:configuredImage,...params}),signal});
          const responseImage=await handleImageGeneration(imageRequest,env,{account_id:identity.sub},{channel:'web_chat',requestId:body.requestId,taskId:body.conversationId,history:turn.history,complete:result=>saveGeneratedImage(env,identity.sub,body,result)});
          const result=await responseImage.json();
          if(!responseImage.ok){await env.DB.prepare("UPDATE web_chat_turns SET error_code=? WHERE request_id=? AND state='running'").bind(result.code||'IMAGE_FAILED',body.requestId).run();await turn.history.finish(result.code==='CANCELLED'?'stopped':'failed');emit({type:'botgo.image.failed',error:result.code==='CANCELLED'?'已停止':imageError(result.code),code:result.code});}
          else emit({type:'botgo.image.completed',...result});
        }catch{const stopped=signal.aborted||await turn.history.cancelled();await turn.history.finish(stopped?'stopped':'failed');emit({error:stopped?'已停止':'回答未完成，请刷新对话后重试'});}
        finally{clearInterval(heartbeat);if(!closed){closed=true;streamController.close();}}
      })();ctx.waitUntil(job);
      return new Response(stream,{headers:{'content-type':'text/event-stream','cache-control':'no-store'}});
    }
    try{
      const headers=new Headers(request.headers);headers.set('idempotency-key',body.requestId);
      const response=await meteredProxy(new Request(request.url,{method:'POST',headers,signal:request.signal}),env,ctx,{accountId:identity.sub,channel:'web_chat',body:turn.body,candidates,agentRoute:route,history:turn.history,taskId:body.conversationId,nativeWebSearch:body.web_search===true});
      if(!response.ok)await turn.history.finish(response.status===499?'stopped':'failed');
      return response;
    }catch(error){await turn.history.finish('failed');throw error;}
  }catch(error){
    return json({error:error.message==='BODY_TOO_LARGE'?'请求过大。':'请求未完成，请稍后重试。'},error.message==='BODY_TOO_LARGE'?413:500);
  }
}
