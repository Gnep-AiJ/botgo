const assert=require('node:assert/strict');
const http=require('node:http');
const {createBridge,configuration,originFor}=require('../opencode-desktop/runtime/bridge.cjs');

(async()=>{
  let sessions=0;const calls=[];let nextStatus=200;let clock=0;
  const fixture={key:'bgk_fixture123',defaultModel:'gpt-5.6-luna',account:{email:'test@example.invalid',balanceMicros:1000000},models:[
    {id:'gpt-5.6-luna',protocol:'chat',price:{input:.2,cached:.02,write:.25,output:1.2},multiplier:.3,modalities:{input:['text','image'],output:['text']},attachment:true,reasoning:true,limit:{context:1050000,output:128000}},
    {id:'gpt-6-astra',protocol:'responses',price:{input:10,cached:1,write:12.5,output:50},multiplier:.3}
  ]};
  const cloud=http.createServer(async(req,res)=>{
    if(req.url==='/api/desktop/opencode/session'){
      assert.equal(req.headers.authorization,'Bearer bgdt_fixture');sessions++;
      res.setHeader('content-type','application/json');res.end(JSON.stringify(fixture));return;
    }
    if(req.url.startsWith('/api/opencode/usage')){
      res.setHeader('content-type','application/json');res.end(JSON.stringify({taskId:new URL(req.url,'http://local').searchParams.get('taskId'),chargedMicros:123}));return;
    }
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    calls.push({url:req.url,headers:req.headers,body:JSON.parse(Buffer.concat(chunks))});
    res.writeHead(nextStatus,{'content-type':'text/event-stream'});
    res.end('data: {"text":"OK"}\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve=>cloud.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${cloud.address().port}`;
  let bridge;
  try{
    let saved={ses_previous_child:'ses_previous_root'};
    const taskStore={load:()=>saved,save:(_email,value)=>{saved=value;}};
    bridge=await createBridge({origin,deviceToken:'bgdt_fixture',now:()=>clock,taskStore});
    const cfg=bridge.config();
    assert.equal(sessions,1);
    assert.deepEqual(cfg.enabled_providers,['botgo-chat','botgo-responses']);
    assert.equal(cfg.provider['botgo-responses'].npm,'@ai-sdk/openai');
    assert.equal(cfg.provider['botgo-chat'].npm,'@ai-sdk/openai-compatible');
    assert.equal(cfg.provider['botgo-chat'].models['gpt-5.6-luna'].cost.input,.06);
    assert.deepEqual(cfg.provider['botgo-chat'].models['gpt-5.6-luna'].modalities,{input:['text','image'],output:['text']});
    assert.equal(cfg.provider['botgo-chat'].models['gpt-5.6-luna'].attachment,true);
    assert.equal(cfg.provider['botgo-chat'].models['gpt-5.6-luna'].reasoning,true);
    assert.deepEqual(cfg.provider['botgo-chat'].models['gpt-5.6-luna'].limit,{context:1050000,output:128000});
    assert.ok(!JSON.stringify(cfg).includes(fixture.key));
    const {baseURL,apiKey}=cfg.provider['botgo-chat'].options;
    const send=(body,headers={},endpoint='/chat/completions')=>fetch(baseURL+endpoint,{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json','x-session-id':'ses_root',...headers},body:JSON.stringify(body)});
    const body={model:'gpt-5.6-luna',messages:[{role:'user',content:'hi'}],stream:true};
    assert.equal((await send(body,{origin:'https://evil.invalid'})).status,401);
    assert.equal((await send(body,{authorization:'Bearer invalid'})).status,401);
    assert.equal((await send(body,{'x-session-id':'bad/id'})).status,400);
    assert.equal((await send(null)).status,400);
    assert.equal((await send(body,{},'/responses')).status,403);
    assert.equal((await send({...body,model:'unauthorized'})).status,403);
    assert.equal((await send({...body,large:'a'.repeat(1000001)})).status,413);
    assert.equal(calls.length,0);
    assert.match(await(await send(body)).text(),/\[DONE\]/);
    await(await send(body,{'x-session-id':'ses_child','x-parent-session-id':'ses_root'})).text();
    await(await send({model:'gpt-6-astra',input:'hi'}, {'x-session-id':'ses_grandchild','x-parent-session-id':'ses_child'},'/responses')).text();
    assert.equal(calls.length,3);
    assert.ok(calls.every(c=>c.headers.authorization===`Bearer ${fixture.key}`&&c.headers['x-botgo-task-id']==='ses_root'));
    assert.equal(new Set(calls.map(c=>c.headers['idempotency-key'])).size,3);
    assert.equal(calls[2].url,'/api/opencode/v1/responses');
    assert.equal((await bridge.usage('ses_grandchild')).taskId,'ses_root');
    assert.equal((await bridge.usage('ses_previous_child')).taskId,'ses_previous_root');
    assert.equal(saved.ses_grandchild,'ses_root');
    clock=24*60*60*1000;
    await Promise.all([send(body).then(r=>r.text()),send(body).then(r=>r.text())]);
    assert.equal(sessions,2,'Concurrent expiration must refresh only once');
    nextStatus=401;
    const count=calls.length;
    assert.equal((await send(body)).status,401);
    assert.equal(calls.length,count+1,'Failed tasks must not replay');
    nextStatus=200;await(await send(body)).text();assert.equal(sessions,3);
    assert.throws(()=>originFor('http://evil.invalid'));
    assert.throws(()=>originFor('https://user:pass@botgo.win'));
    assert.throws(()=>configuration({...fixture,models:[]},baseURL,apiKey));
    console.log('OpenCode bridge: HTTP streaming, dual protocols, account/session validation, key isolation, task ancestry, refresh, no replay and request limits passed');
  }finally{
    await bridge?.close();cloud.closeAllConnections();await new Promise(resolve=>cloud.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
