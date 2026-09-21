const assert=require('node:assert/strict');
const {setTimeout:sleep}=require('node:timers/promises');
const {fetchRead}=require('../opencode-desktop/runtime/network.cjs');
const {createBridge}=require('../opencode-desktop/runtime/bridge.cjs');
const fixture={key:'bgk_fixture',defaultModel:'model',account:{email:'fixture@invalid',balanceMicros:1000000},models:[{id:'model',protocol:'chat',price:{input:1,output:1,cached:0,write:0},multiplier:.3}]};
const reset=()=>Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}});
const refused=()=>Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNREFUSED'}});
(async()=>{
  let attempts=0;
  const read=await fetchRead(async()=>{attempts++;return new Response('{}',{status:attempts===3?200:503});},'http://fixture',{}, {delays:[1,1]});
  assert.equal(read.status,200);assert.equal(attempts,3);
  attempts=0;await assert.rejects(fetchRead(async()=>{attempts++;throw reset();},'http://fixture',{}, {session:true,delays:[1,1]}));assert.equal(attempts,1,'ambiguous session issuance never repeats');
  attempts=0;await assert.rejects(fetchRead(async()=>{attempts++;throw refused();},'http://fixture',{}, {session:true,delays:[1,1]}));assert.equal(attempts,3,'session retries twice only before connection');
  attempts=0;const stop=new AbortController();
  const waiting=fetchRead(async()=>{attempts++;return new Response('',{status:503});},'http://fixture',{}, {signal:stop.signal,delays:[100,100]});
  await sleep(10);stop.abort();await assert.rejects(waiting);await sleep(120);assert.equal(attempts,1);

  let mode='safe',modelCalls=0,clock=0,sessionCalls=0,releaseRefresh;
  const ids=[],diagnostics=[];
  const bridge=await createBridge({origin:'https://botgo.test',deviceToken:'bgdt_fixture',initialSession:fixture,now:()=>clock,retryDelays:[1,1],onDiagnostic:d=>diagnostics.push(d),fetchImpl:async(url,init)=>{
    if(url.endsWith('/session')){sessionCalls++;await new Promise(resolve=>{releaseRefresh=resolve;});return Response.json(fixture);}
    modelCalls++;ids.push(init.headers['idempotency-key']);
    if(mode==='connect')throw refused();
    if(mode==='uncertain')throw reset();
    if(mode==='safe')return Response.json({code:'UPSTREAM_UNAVAILABLE',retryable:true},{status:502,headers:{'x-botgo-request-id':'fixture_request','retry-after':'2'}});
    if(mode==='duplicate')return Response.json({code:'REQUEST_EXISTS',retryable:true},{status:409});
    if(mode==='forged')return Response.json({code:'ARBITRARY_UPSTREAM_FLAG',retryable:true},{status:502});
    if(mode==='partial')return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"tool_calls":[{"id":"call_once"}]}}]}\n\n'));setTimeout(()=>c.error(reset()),20);}}),{headers:{'content-type':'text/event-stream'}});
    return new Response('data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  }});
  const {baseURL,apiKey}=bridge.config().provider['botgo-chat'].options;
  const send=signal=>fetch(baseURL+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+apiKey,'x-session-id':'ses_fixture','content-type':'application/json'},body:JSON.stringify({model:'model',messages:[],stream:true}),signal});
  try{
    let res=await send();assert.equal(res.headers.get('x-botgo-retryable'),'1');assert.match((await res.json()).error.message,/请求编号/);assert.equal(modelCalls,1);
    for(const [next,expected] of [['duplicate','0'],['forged','0'],['uncertain','0'],['connect','1']]){mode=next;res=await send();assert.equal(res.headers.get('x-botgo-retryable'),expected,next);await res.text();}
    mode='partial';res=await send();assert.equal(res.headers.get('x-botgo-retryable'),'0');const partial=await res.text();assert.equal((partial.match(/call_once/g)||[]).length,1);assert.match(partial,/响应中断/);assert.equal(modelCalls,6,'bridge never repeats an inference');
    mode='ok';clock=24*3600000;diagnostics.length=0;const a=new AbortController();const requestA=send(a.signal);const requestB=send();
    while(!releaseRefresh)await sleep(5);
    a.abort();await assert.rejects(requestA);
    // Wait until the loopback disconnect reaches the server before resolving its fixture.
    for(let i=0;i<100&&!diagnostics.some(d=>d.stage==='session');i++)await sleep(5);
    assert.ok(diagnostics.some(d=>d.stage==='session'));
    releaseRefresh();await(await requestB).text();assert.equal(sessionCalls,1,'shared refresh survives one cancelled waiter');assert.equal(modelCalls,7,'cancelled waiter cannot submit inference');
    assert.equal(new Set(ids).size,ids.length,'only a new native attempt creates a new request ID');
    assert.ok(!JSON.stringify(diagnostics).includes('bgk_fixture'));assert.ok(diagnostics.some(d=>d.stage==='first-byte'));
  }finally{await bridge.close();}
  console.log('Network boundaries: bounded retry, uncertain issuance, cancellation, single-flight, partial tool stream and redacted timings passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
