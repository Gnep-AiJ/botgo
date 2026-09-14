const http=require('node:http');
const crypto=require('node:crypto');
const {once}=require('node:events');

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

async function createBridge({origin,deviceToken,fetchImpl=fetch,initialSession=undefined,now=Date.now,taskStore={load:(_email)=>({}),save:(_email,_value)=>{}}}){
  origin=originFor(origin);
  if(!/^bgdt_[A-Za-z0-9_-]+$/.test(deviceToken))throw Error('Invalid device credential');
  let session=initialSession?validateSession(initialSession):undefined;
  let expiresAt=session?now()+23*60*60*1000:0;
  let pending;
  let closed=false;
  const aborts=new Set();
  const roots=new Map();
  const localKey=crypto.randomBytes(32).toString('hex');
  async function refresh(){
    if(closed)throw Error('Bridge is closed');
    if(session&&now()<expiresAt)return session;
    if(pending)return pending;
    pending=(async()=>{
      const response=await fetchImpl(`${origin}/api/desktop/opencode/session`,{method:'POST',redirect:'error',
        headers:{authorization:`Bearer ${deviceToken}`},signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Object.assign(Error(`BotGo session HTTP ${response.status}`),{status:response.status});
      session=validateSession(await response.json());
      expiresAt=now()+23*60*60*1000;
      return session;
    })().finally(()=>{pending=undefined;});
    return pending;
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
    const fail=(status,message)=>{
      if(response.headersSent){response.destroy();return;}
      response.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});
      response.end(JSON.stringify({error:{message,type:'botgo_error'}}));
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
      const current=await refresh();
      const protocol=request.url.endsWith('/responses')?'responses':'chat';
      if(!current.models.some(m=>m.id===body.model&&m.protocol===protocol))return fail(403,'Model or protocol not available');
      const taskId=taskFor(request);
      const idempotency=crypto.randomUUID();
      const result=await fetchImpl(`${origin}/api/opencode${request.url}`,{method:'POST',redirect:'error',
        headers:{authorization:`Bearer ${current.key}`,'content-type':'application/json','x-botgo-task-id':taskId,'idempotency-key':idempotency},
        body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(300000)])});
      // Never replay a request after a credential or connection failure.
      if(result.status===401)expiresAt=0;
      response.writeHead(result.status,{'content-type':result.headers.get('content-type')||'application/json','cache-control':'no-store'});
      if(result.body)for await(const chunk of result.body){
        if(!response.write(Buffer.from(chunk)))await once(response,'drain',{signal:controller.signal});
      }
      response.end();
    }catch(error){fail(error.status||502,'BotGo request failed; the task was not automatically replayed.');}
    finally{aborts.delete(controller);response.off('close',disconnect);}
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
      const response=await fetchImpl(`${origin}/api/opencode/usage?taskId=${encodeURIComponent(roots.get(taskId)||taskId)}`,{
        headers:{authorization:`Bearer ${current.key}`},redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error(`Usage HTTP ${response.status}`);
      return response.json();
    },
    async close(){closed=true;for(const controller of aborts)controller.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  };
}

module.exports={originFor,validateSession,configuration,createBridge};
