const http=require('node:http');
const crypto=require('node:crypto');
const {originFor}=require('./bridge.cjs');

async function beginAuthorization({origin,save,fetchImpl=fetch,timeoutMs=300000}){
  origin=originFor(origin);
  const state=crypto.randomBytes(32).toString('base64url');
  const verifier=crypto.randomBytes(32).toString('base64url');
  let started;let settled=false;let exchanging=false;let saving=false;let timer;
  let accept,reject;
  const done=new Promise((resolve,fail)=>{accept=resolve;reject=fail;});
  done.catch(()=>{});
  const controller=new AbortController();
  const request=async(endpoint,body)=>{
    const response=await fetchImpl(`${origin}/api${endpoint}`,{method:'POST',redirect:'error',
      signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)]),
      headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    if(!response.ok)throw Object.assign(Error(`Authorization HTTP ${response.status}`),{status:response.status});
    return response.json();
  };
  const cleanup=()=>{clearTimeout(timer);if(server.listening)server.close();};
  const fail=error=>{if(settled)return;settled=true;controller.abort();cleanup();reject(error);};
  const server=http.createServer(async(req,res)=>{
    const reply=(status,text)=>{res.writeHead(status,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'});res.end(text);};
    if(settled)return reply(410,'BotGo: authorization ended.');
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method!=='GET'||url.pathname!=='/callback'||!started)return reply(404,'Not found');
    const actual=Buffer.from(url.searchParams.get('state')||'');
    const expected=Buffer.from(state);
    const code=url.searchParams.get('code')||'';
    if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected)||!/^bgac_[A-Za-z0-9_-]{1,256}$/.test(code))return reply(400,'BotGo: invalid callback.');
    if(exchanging)return reply(409,'BotGo: authorization in progress.');
    exchanging=true;
    try{
      const result=await request('/desktop/authorize/exchange',{authorizationId:started.authorizationId,authorizationCode:code,verifier});
      if(settled)return reply(410,'BotGo: authorization ended.');
      if(!/^bgdt_[A-Za-z0-9_-]+$/.test(result.deviceToken||''))throw Error('Invalid device credential');
      clearTimeout(timer);
      // Complete credential storage atomically before publishing authenticated state.
      saving=true;
      await save({deviceToken:result.deviceToken});
      settled=true;cleanup();reply(200,'BotGo: signed in. You can return to the desktop.');accept(result);
    }catch(error){reply(500,'BotGo: authorization failed. Please return to the desktop.');fail(error);}
  });
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    timer=setTimeout(()=>fail(Error('Authorization timed out')),timeoutMs);
    started=await Promise.race([request('/desktop/authorize/start',{deviceLabel:'BotGo OpenCode Desktop',verifier}),done]);
    if(!started?.authorizationId)throw Error('Invalid authorization response');
    const url=new URL('/desktop-authorize.html',origin);
    url.searchParams.set('request',started.authorizationId);url.searchParams.set('state',state);
    url.searchParams.set('callback',`http://127.0.0.1:${server.address().port}/callback`);
    url.searchParams.set('client','desktop');
    return {url:url.toString(),done,cancel(){
      if(settled||saving)return false;
      fail(Object.assign(Error('Authorization cancelled'),{code:'CANCELLED'}));
      // Remote cancellation is best effort and cannot hold the local listener open.
      void fetchImpl(`${origin}/api/desktop/authorize/cancel`,{method:'POST',redirect:'error',
        headers:{'content-type':'application/json'},body:JSON.stringify({authorizationId:started.authorizationId,verifier}),
        signal:AbortSignal.timeout(5000)}).catch(()=>{});
      return true;
    }};
  }catch(error){fail(error);throw error;}
}
module.exports={beginAuthorization};
