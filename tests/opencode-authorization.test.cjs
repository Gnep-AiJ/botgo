require('./opencode-credentials.test.cjs');
const assert=require('node:assert/strict');
const http=require('node:http');
const {beginAuthorization}=require('../opencode-desktop/runtime/authorize.cjs');

(async()=>{
  let exchanges=0;let stored=[];let delay=0;let starts=0;
  const cloud=http.createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    const body=JSON.parse(Buffer.concat(chunks).toString());
    res.setHeader('content-type','application/json');
    if(req.url.endsWith('/start')){starts++;res.end(JSON.stringify({authorizationId:`request-${starts}`}));return;}
    if(req.url.endsWith('/exchange')){
      exchanges++;assert.match(body.verifier,/^[A-Za-z0-9_-]{43}$/);
      assert.equal(body.authorizationCode,'bgac_code');
      if(delay)await new Promise(r=>setTimeout(r,delay));
      res.end(JSON.stringify({deviceToken:'bgdt_test',account:{email:'test@example.invalid'}}));return;
    }
    res.end('{}');
  });
  await new Promise(r=>cloud.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${cloud.address().port}`;
  const save=value=>stored.push(value);
  let login;
  const callback=(login,state)=>{
    const page=new URL(login.url);const target=new URL(page.searchParams.get('callback'));
    target.searchParams.set('code','bgac_code');target.searchParams.set('state',state??page.searchParams.get('state'));return target;
  };
  try{
    login=await beginAuthorization({origin,save});
    const page=new URL(login.url);
    assert.equal(page.pathname,'/desktop-authorize.html');
    assert.equal(page.searchParams.get('client'),'desktop');
    assert.ok(!page.searchParams.has('verifier'));
    assert.equal((await fetch(callback(login,'invalid'))).status,400);
    assert.equal(exchanges,0);
    delay=80;
    const valid=fetch(callback(login));
    await new Promise(r=>setTimeout(r,20));
    assert.equal((await fetch(callback(login))).status,409);
    assert.equal((await valid).status,200);
    assert.equal((await login.done).deviceToken,'bgdt_test');
    assert.equal(exchanges,1);assert.deepEqual(stored,[{deviceToken:'bgdt_test'}]);
    login=await beginAuthorization({origin,save});
    const url=callback(login);login.cancel();await assert.rejects(login.done,/cancelled/);
    await assert.rejects(fetch(url));assert.equal(exchanges,1);
    login=await beginAuthorization({origin,save});
    delay=100;
    const inFlight=fetch(callback(login)).catch(()=>null);
    await new Promise(r=>setTimeout(r,20));
    login.cancel();await assert.rejects(login.done,/cancelled/);
    await inFlight;await new Promise(r=>setTimeout(r,110));
    assert.equal(stored.length,1,'Cancellation during exchange must prevent credential storage');
    login=await beginAuthorization({origin,save,timeoutMs:60});
    await assert.rejects(login.done,/timed out/);assert.equal(stored.length,1);
    delay=0;
    login=await beginAuthorization({origin,save(){throw Error('Windows encryption unavailable');}});
    assert.equal((await fetch(callback(login))).status,500);
    await assert.rejects(login.done,/encryption/);assert.equal(stored.length,1);
    console.log('OpenCode authorization: proof/state, callback validation, duplicate exchange, cancellation, timeout and credential-store failure passed');
  }finally{
    login?.cancel();cloud.closeAllConnections();await new Promise(r=>cloud.close(r));
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
