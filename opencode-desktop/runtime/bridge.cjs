const http=require('node:http');
const crypto=require('node:crypto');
const {once}=require('node:events');
const {beforeSend,abortable,fetchRead}=require('./network.cjs');

const retryCodes=new Set(['AGENT_CONCURRENCY_LIMIT','ACCOUNT_CONCURRENCY_LIMIT','UPSTREAM_CAPACITY_LIMIT','UPSTREAM_TIMEOUT','UPSTREAM_UNAVAILABLE']);

const taskPattern=/^[A-Za-z0-9_-]{1,128}$/;
const modelPattern=/^[A-Za-z0-9._-]{1,128}$/;
function originFor(value){
  const url=new URL(value);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1'))throw Error('Invalid BotGo origin');
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Expected an origin, not a URL path');
  return url.origin;
}

function validateSession(data){
  if(!data||typeof data.key!=='string'||!/^bgk_[A-Za-z0-9_-]+$/.test(data.key))throw Error('Invalid execution credential');
  if(!Array.isArray(data.models)||data.models.length===0)throw Error('No available BotGo models');
  const seen=new Set();
  for(const model of data.models){
    if(!model||typeof model.id!=='string'||!modelPattern.test(model.id)||!['chat','responses'].includes(model.protocol)||seen.has(model.id))throw Error('Invalid model catalog');
    seen.add(model.id);
    if(!model.price||!['input','output','cached','write'].every(k=>Number.isFinite(model.price[k])&&model.price[k]>=0))throw Error('Invalid model prices');
    if(!Number.isFinite(model.multiplier)||model.multiplier<0)throw Error('Invalid price multiplier');
  }
  if(!seen.has(data.defaultModel)||!data.account||typeof data.account.email!=='string'||!Number.isSafeInteger(data.account.balanceMicros))throw Error('Invalid account session');
  return data;
}

function configuration(session,baseURL,localKey){
  validateSession(session);
  const provider={};
  for(const protocol of ['chat','responses']){
    const models=session.models.filter(m=>m.protocol===protocol);
    if(!models.length)continue;
    provider[`botgo-${protocol}`]={
      name:'BotGo',npm:protocol==='chat'?'@ai-sdk/openai-compatible':'@ai-sdk/openai',
      options:{baseURL,apiKey:localKey},
      models:Object.fromEntries(models.map(m=>[m.id,{
        name:m.name||m.id,tool_call:true,
        // Application safety caps, not claims about upstream maximum context.
        limit:m.limit||{context:128000,output:8192},
        cost:{input:m.price.input*m.multiplier,output:m.price.output*m.multiplier,
          cache_read:m.price.cached*m.multiplier,cache_write:m.price.write*m.multiplier},
        options:{store:false},
      }]))
    };
  }
  const selected=session.models.find(m=>m.id===session.defaultModel);
  return {enabled_providers:Object.keys(provider),provider,model:`botgo-${selected.protocol}/${selected.id}`,
    small_model:`botgo-${selected.protocol}/${selected.id}`,share:'disabled',autoupdate:false};
}

async function createBridge({origin,deviceToken,fetchImpl=fetch,initialSession=undefined,now=Date.now,onDiagnostic=(_data)=>{},retryDelays=[500,1500],taskStore={load:(_email)=>({}),save:(_email,_value)=>{}}}){
  origin=originFor(origin);
  if(!/^bgdt_[A-Za-z0-9_-]+$/.test(deviceToken))throw Error('Invalid device credential');
  let session=initialSession?validateSession(initialSession):undefined;
  let expiresAt=session?now()+23*60*60*1000:0;
  let pending;
  let closed=false;
  const lifetime=new AbortController();
  const aborts=new Set();
  const roots=new Map();
  const localKey=crypto.randomBytes(32).toString('hex');
  async function refresh(signal=lifetime.signal){
    signal.throwIfAborted();
    if(closed)throw Error('Bridge is closed');
    if(session&&now()<expiresAt)return session;
    if(!pending){
    const flight={controller:new AbortController(),users:0,promise:null};
    pending=flight;
    flight.promise=(async()=>{
      const response=await fetchRead(fetchImpl,`${origin}/api/desktop/opencode/session`,{method:'POST',redirect:'error',
        headers:{authorization:`Bearer ${deviceToken}`}},{session:true,signal:AbortSignal.any([lifetime.signal,flight.controller.signal]),delays:retryDelays});
      if(!response.ok)throw Object.assign(Error(`BotGo session HTTP ${response.status}`),{status:response.status});
      session=validateSession(await response.json());
      expiresAt=now()+23*60*60*1000;
      return session;
    })().finally(()=>{if(pending===flight)pending=undefined;});
    }
    const flight=pending;flight.users++;
    try{return await abortable(flight.promise,signal);}
    finally{if(--flight.users===0){if(pending===flight)pending=undefined;flight.controller.abort();}}
  }
  await refresh();
  const saved=taskStore.load(session.account.email);
  if(!saved||typeof saved!=='object'||Array.isArray(saved)||Object.keys(saved).length>10000)throw Error('Invalid saved task map');
  for(const [task,root] of Object.entries(saved)){
    if(!taskPattern.test(task)||typeof root!=='string'||!taskPattern.test(root))throw Error('Invalid saved task ancestry');
    roots.set(task,root);
  }
  function taskFor(request){
    const task=request.headers['x-session-id'];
    const parent=request.headers['x-parent-session-id'];
    if(typeof task!=='string'||!taskPattern.test(task))throw Object.assign(Error('Session ID required'),{status:400});
    if(parent!==undefined&&(typeof parent!=='string'||!taskPattern.test(parent)))throw Object.assign(Error('Invalid parent session'),{status:400});
    if(roots.size>=10000&&!roots.has(task))throw Object.assign(Error('Session map capacity reached'),{status:429});
    const root=parent?(roots.get(parent)||parent):(roots.get(task)||task);
    if(roots.get(task)!==root){roots.set(task,root);taskStore.save(session.account.email,Object.fromEntries(roots));}
    return root;
  }
  const server=http.createServer(async(request,response)=>{
    const requestId=crypto.randomUUID(),startedAt=now();let stage='prepare';
    const fail=(status,message,code='REQUEST_FAILED',retryable=false,remoteId=requestId,retryAfter)=>{
      if(response.headersSent){
        if(!response.destroyed&&String(response.getHeader('content-type')||'').includes('text/event-stream'))response.end(`data: ${JSON.stringify({type:'error',code:'STREAM_INTERRUPTED',message:`响应中断，请手动继续。\n请求编号：${remoteId}`,error:{message:`响应中断，请手动继续。\n请求编号：${remoteId}`,type:'botgo_error',code:'STREAM_INTERRUPTED'}})}\n\n`);
        else response.destroy();
        return;
      }
      response.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-botgo-retryable':retryable?'1':'0','x-botgo-request-id':remoteId,...(retryAfter?{'retry-after':retryAfter}:{})});
      response.end(JSON.stringify({error:{message:`${message}\n请求编号：${remoteId}`,type:'botgo_error',code},code,retryable,requestId:remoteId}));
    };
    const auth=Buffer.from(request.headers.authorization||'');
    const expected=Buffer.from(`Bearer ${localKey}`);
    if(request.headers.origin||auth.length!==expected.length||!crypto.timingSafeEqual(auth,expected))return fail(401,'Unauthorized local request');
    if(request.method!=='POST'||!['/v1/chat/completions','/v1/responses'].includes(request.url))return fail(404,'Unsupported route');
    const controller=new AbortController();
    aborts.add(controller);
    const disconnect=()=>{if(!response.writableEnded)controller.abort();};
    response.once('close',disconnect);
    try{
      let length=0;const chunks=[];
      for await(const chunk of request){length+=chunk.length;if(length>1000000)return fail(413,'Request exceeds 1 MB');chunks.push(chunk);}
      let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return fail(400,'Invalid JSON');}
      if(!body||typeof body.model!=='string')return fail(400,'Model required');
      stage='session';const current=await refresh(controller.signal);
      onDiagnostic({stage:'session',requestId,elapsedMs:now()-startedAt});
      controller.signal.throwIfAborted();
      const protocol=request.url.endsWith('/responses')?'responses':'chat';
      if(!current.models.some(m=>m.id===body.model&&m.protocol===protocol))return fail(403,'Model or protocol not available');
      const taskId=taskFor(request);
      const idempotency=requestId;
      stage='request';
      const result=await fetchImpl(`${origin}/api/opencode${request.url}`,{method:'POST',redirect:'error',
        headers:{authorization:`Bearer ${current.key}`,'content-type':'application/json','x-botgo-task-id':taskId,'idempotency-key':idempotency},
        body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(300000)])});
      const workerTimings={};
      for(const [key,label] of [['prepare','workerPrepareMs'],['upstream_headers','upstreamHeadersMs'],['first_byte','workerFirstByteMs']]){
        const match=(result.headers.get('server-timing')||'').match(new RegExp(`(?:^|,)${key};dur=(\\d+(?:\\.\\d+)?)`));
        if(match)workerTimings[label]=Number(match[1]);
      }
      onDiagnostic({stage:'headers',requestId,elapsedMs:now()-startedAt,status:result.status,...workerTimings});
      // Native retry is the sole owner of model retries; this bridge never replays.
      if(result.status===401)expiresAt=0;
      const remoteId=result.headers.get('x-botgo-request-id');
      const safeId=remoteId&&/^[A-Za-z0-9:_-]{1,256}$/.test(remoteId)?remoteId:requestId;
      if(!result.ok){
        let data={};
        if(result.body){const reader=result.body.getReader();let size=0,text='';try{for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>16384)break;text+=new TextDecoder().decode(chunk.value);}data=JSON.parse(text);}catch{}finally{await reader.cancel().catch(()=>{});}}
        const code=typeof data.code==='string'&&/^[A-Z_]{1,64}$/.test(data.code)?data.code:'HTTP_ERROR';
        const retryable=data.retryable===true&&retryCodes.has(code)&&[429,502,503,504].includes(result.status);
        const message=retryable?'服务暂时繁忙，正在重试。':result.status===401?'登录已失效，请重新连接。':result.status===402?'余额不足，请充值后继续。':code==='REQUEST_EXISTS'?'请求已受理，请勿重复提交。':code==='UPSTREAM_REJECTED'?'上游拒绝了请求，请检查模型配置。':result.status===403?'当前账户或模型没有访问权限。':'请求未完成，请稍后手动继续。';
        const seconds=Number(result.headers.get('retry-after'));
        return fail(result.status,message,code,retryable,safeId,retryable?String(Number.isFinite(seconds)&&seconds>0?Math.min(seconds,30):2):undefined);
      }
      stage='stream';
      response.setHeader('content-type',result.headers.get('content-type')||'application/json');
      response.writeHead(result.status,{'content-type':result.headers.get('content-type')||'application/json','cache-control':'no-store','x-botgo-retryable':'0','x-botgo-request-id':safeId});
      let first=true;
      if(result.body)for await(const chunk of result.body){
        if(first){first=false;onDiagnostic({stage:'first-byte',requestId,elapsedMs:now()-startedAt});}
        if(!response.write(Buffer.from(chunk)))await once(response,'drain',{signal:controller.signal});
      }
      response.end();
    }catch(error){
      const stopped=controller.signal.aborted,unsent=stage==='request'&&beforeSend(error);
      onDiagnostic({stage,requestId,elapsedMs:now()-startedAt,...require('./diagnostic.cjs').diagnostic(error,stage)});
      fail(error.status||502,stopped?'请求已停止。':unsent?'连接暂时失败，正在重试。':error.status===401?'登录已失效，请重新连接。':error.name==='TimeoutError'?'请求超时，执行状态未知，请稍后手动继续。':'连接中断，执行状态未知，请稍后手动继续。',stopped?'CANCELLED':unsent?'CONNECT_FAILED':'REQUEST_UNCERTAIN',!stopped&&unsent);
    }
    finally{onDiagnostic({stage:'finished',requestId,elapsedMs:now()-startedAt});aborts.delete(controller);response.off('close',disconnect);}
  });
  server.requestTimeout=300000;
  server.headersTimeout=15000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const baseURL=`http://127.0.0.1:${server.address().port}/v1`;
  return {
    config:()=>configuration(session,baseURL,localKey),
    account:()=>({...session.account}),
    async usage(taskId){
      if(typeof taskId!=='string'||!taskPattern.test(taskId))throw Error('Invalid task ID');
      const current=await refresh();
      const response=await fetchRead(fetchImpl,`${origin}/api/opencode/usage?taskId=${encodeURIComponent(roots.get(taskId)||taskId)}`,{
        headers:{authorization:`Bearer ${current.key}`},redirect:'error'},{signal:lifetime.signal,delays:retryDelays});
      if(!response.ok)throw Error(`Usage HTTP ${response.status}`);
      return response.json();
    },
    async close(){closed=true;lifetime.abort();for(const controller of aborts)controller.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  };
}

module.exports={originFor,validateSession,configuration,createBridge};
