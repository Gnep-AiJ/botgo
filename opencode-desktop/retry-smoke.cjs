// Real Electron + native task loop, isolated profile, local inference fixture only.
const {app}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
const {once}=require('node:events');
const {createBridge}=require('./runtime/bridge.cjs');
const root=path.resolve(__dirname,'..'),desktop=path.join(root,'artifacts/opencode/packages/desktop');
const out=path.join(root,'artifacts/verification/native-retry',String(Date.now()));
fs.mkdirSync(out,{recursive:true});app.disableHardwareAcceleration();app.setAppPath(desktop);
app.setPath('userData',path.join(out,'profile'));app.setPath('sessionData',path.join(out,'chromium'));
process.env.BOTGO_PROFILE_ROOT=path.join(out,'profile');process.env.BOTGO_NATIVE_SMOKE='1';
process.env.OPENCODE_DISABLE_MODELS_FETCH='true';process.env.OPENCODE_DISABLE_AUTOUPDATE='true';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let bridge,finished=false,started=false,mode='recover',count=0;
const evidence={};
const finish=async error=>{if(finished)return;finished=true;await bridge?.close();const result={ok:!error,...evidence,error:error?.message};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({...result,out}));app.exit(error?1:0);};
setTimeout(()=>finish(Error('RETRY_SMOKE_TIMEOUT')),180000).unref();
process.on('unhandledRejection',error=>finish(error));
app.on('browser-window-created',(_event,win)=>win.webContents.on('did-finish-load',async()=>{
  if(started)return;started=true;
  try{
    const server=await win.webContents.executeJavaScript('window.api.awaitInitialization()');
    assert.ok(server.url&&server.password);
    const project=path.join(out,'project');fs.mkdirSync(project);
    const request=async(route,body)=>{const url=new URL(route,server.url);url.searchParams.set('directory',project);const r=await fetch(url,{method:body?'POST':'GET',headers:{authorization:'Basic '+Buffer.from((server.username||'opencode')+':'+server.password).toString('base64'),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('NATIVE_HTTP_'+r.status);return r.status===204?null:r.json();};
    const session=await request('/session',{title:'BotGo 重试验证',permission:[{permission:'*',pattern:'*',action:'deny'}]});
    const route='/'+Buffer.from(project).toString('base64url')+'/session/'+session.id;
    await win.webContents.executeJavaScript(`window.api.getWindowID().then(id=>localStorage.setItem('opencode.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)}))`);
    const loaded=once(win.webContents,'did-finish-load');win.webContents.reload();await loaded;
    for(let i=0;i<120;i++){if(await win.webContents.executeJavaScript("!!document.querySelector('[contenteditable=true],textarea')"))break;await sleep(100);}
    const send=()=>request('/session/'+session.id+'/message',{model:{providerID:'botgo-chat',modelID:'fixture'},parts:[{type:'text',text:'Reply OK. Do not use tools.'}]});
    const waitRetry=async()=>{for(let i=0;i<120;i++){const status=await request('/session/status');if(status[session.id]?.type==='retry')return status[session.id];await sleep(50);}throw Error('RETRY_STATUS_MISSING');};
    let pending=send();const retry=await waitRetry();assert.equal(retry.attempt,1);
    let visible=false;for(let i=0;i<60;i++){visible=await win.webContents.executeJavaScript("document.body.innerText.includes('服务暂时繁忙')");if(visible)break;await sleep(50);}
    assert.ok(visible,'native retry message must actually render');await sleep(250);fs.writeFileSync(path.join(out,'retry.png'),(await win.webContents.capturePage()).toPNG());
    const result=await pending;assert.ok(!result.info?.error,JSON.stringify(result.info?.error));assert.ok(count>=2);evidence.recovered=true;
    mode='exhaust';count=0;pending=send();await waitRetry();
    // Use the native renderer stop control, retaining native cancellation semantics.
    const stopped=await win.webContents.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>/stop|停止/i.test((b.getAttribute('aria-label')||'')+' '+(b.getAttribute('title')||'')+' '+b.innerText));if(!button)return false;button.click();return true})()`);
    if(!stopped)throw Error('NATIVE_STOP_BUTTON_MISSING');
    await pending;const after=count;await sleep(2400);assert.equal(count,after);evidence.stop=true;
    mode='partial';count=0;const partial=await send();assert.ok(partial.info?.error);assert.equal(count,1);evidence.partialNoReplay=true;
    mode='recover';count=1;const continued=await send();assert.ok(!continued.info?.error);evidence.continueAfterFailure=true;
    mode='exhaust';count=0;const exhausted=await send();assert.ok(exhausted.info?.error);assert.equal(count,6,'initial attempt plus five native retries');evidence.maxRetries=true;
    await win.webContents.executeJavaScript("document.querySelector('.botgo-account-trigger').click()");await sleep(150);
    fs.writeFileSync(path.join(out,'account.png'),(await win.webContents.capturePage()).toPNG());
    evidence.account=await win.webContents.executeJavaScript("document.querySelector('.botgo-account-dialog').innerText.includes('¥12.00')");assert.ok(evidence.account);
    await finish();
  }catch(error){await finish(error);}
}));
(async()=>{
  const initialSession={key:'bgk_fixture',defaultModel:'fixture',account:{email:'fixture@invalid',balanceMicros:12000000},models:[{id:'fixture',name:'Fixture',protocol:'chat',price:{input:0,output:0,cached:0,write:0},multiplier:.3}]};
  bridge=await createBridge({origin:'https://fixture.invalid',deviceToken:'bgdt_fixture',initialSession,fetchImpl:async()=>{
    count++;
    if(mode==='exhaust'||mode==='recover'&&count===1)return Response.json({code:'UPSTREAM_UNAVAILABLE',retryable:true},{status:503,headers:{'retry-after':mode==='recover'?'5':'2'}});
    const chunk={id:'chatcmpl-fixture',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{content:'OK'},finish_reason:null}]};
    if(mode==='partial')return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: '+JSON.stringify(chunk)+'\n\n'));setTimeout(()=>c.error(Error('fixture disconnected')),30);}}),{headers:{'content-type':'text/event-stream'}});
    return new Response('data: '+JSON.stringify(chunk)+'\n\ndata: '+JSON.stringify({...chunk,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  }});
  process.env.OPENCODE_CONFIG_CONTENT=JSON.stringify(bridge.config());
  await import(pathToFileURL(path.join(desktop,'out/main/index.js')).href);
})().catch(finish);
