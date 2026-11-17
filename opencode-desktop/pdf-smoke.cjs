// Real native composer upload and inference, using only synthetic documents.
const {app,shell}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const readline=require('node:readline');
const {pathToFileURL}=require('node:url'),{once}=require('node:events');
const {createBridge}=require('./runtime/bridge.cjs');
const {root,source}=require('./paths.cjs'),desktop=path.join(source,'packages/desktop');
const out=path.join(root,'artifacts/verification/opencode-1.18.35-upgrade/pdf-native',String(Date.now()));
const fixtures=path.join(root,'artifacts/verification/opencode-1.18.35-upgrade/pdf-fixtures');
const manifest=process.argv.includes('--links-only')?{}:JSON.parse(fs.readFileSync(path.join(fixtures,'manifest.json')));
fs.mkdirSync(out,{recursive:true});app.disableHardwareAcceleration();app.setAppPath(desktop);
app.setPath('userData',path.join(out,'profile'));app.setPath('sessionData',path.join(out,'chromium'));
process.env.BOTGO_PROFILE_ROOT=path.join(out,'profile');process.env.BOTGO_NATIVE_SMOKE='1';
process.env.OPENCODE_DISABLE_MODELS_FETCH='true';process.env.OPENCODE_DISABLE_AUTOUPDATE='true';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let bridge,key,started=false,finished=false;
const evidence={requests:[],uploads:[],fixtureOnly:true};
const scrub=value=>String(value).replaceAll(key||'NEVER_MATCH_SECRET','[redacted]').replace(/(?:sk-|bgdt_|bgk_)[A-Za-z0-9_-]+/g,'[redacted]');
async function finish(error){if(finished)return;finished=true;if(error){const win=require('electron').BrowserWindow.getAllWindows()[0];if(win&&!win.isDestroyed()){fs.writeFileSync(path.join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());evidence.failureUI=await win.webContents.executeJavaScript('document.body.innerText');}}await bridge?.close();key='';fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({ok:!error,...evidence,error:error? scrub(error.stack):undefined},null,2));console.log(JSON.stringify({ok:!error,out,error:error?scrub(error.message):undefined}));app.exit(error?1:0);}
setTimeout(()=>finish(Error('PDF_NATIVE_TIMEOUT')),1200000).unref();
process.on('unhandledRejection',finish);process.on('uncaughtException',finish);
app.on('browser-window-created',(_event,win)=>win.webContents.on('did-finish-load',async()=>{
  if(started)return;started=true;
  try{
    const server=await win.webContents.executeJavaScript('window.api.awaitInitialization()');
    const project=path.join(out,'project');fs.mkdirSync(project);
    fs.writeFileSync(path.join(project,'opencode.json'),JSON.stringify({
      permission:{bash:'deny',read:'allow'},
      mcp:{'fixture-disabled':{type:'local',command:[process.execPath,'-e','process.exit(0)'],enabled:false}},
      agent:{'fixture-audit':{description:'Isolated regression agent',mode:'subagent',prompt:'Inspect only the synthetic project'}},
      enabled_providers:['fixture-external'],
      provider:{'fixture-external':{npm:'@ai-sdk/openai',models:{fixture:{name:'Forbidden external fixture'}},options:{apiKey:'sk-fixture'}}},
    }));
    const request=async(route,body,method)=>{const url=new URL(route,server.url);url.searchParams.set('directory',project);const r=await fetch(url,{method:method||(body?'POST':'GET'),headers:{authorization:'Basic '+Buffer.from((server.username||'opencode')+':'+server.password).toString('base64'),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('NATIVE_HTTP_'+route+'_'+r.status);return r.status===204?null:r.json();};
    evidence.engineVersion=(await request('/global/health')).version;
    assert.equal(evidence.engineVersion,require('./paths.cjs').upstream.version);
    evidence.providers=(await request('/provider')).all.map(p=>p.id);
    evidence.agents=(await request('/agent')).map(a=>a.name);
    assert.ok(evidence.agents.includes('fixture-audit'));
    const nativeConfig=await request('/config');
    assert.equal(nativeConfig.permission.bash,'deny');assert.equal(nativeConfig.permission.read,'allow');
    assert.deepEqual(nativeConfig.enabled_providers,['botgo-chat','botgo-responses']);
    evidence.projectSettings={permissions:true,agents:true,providersLocked:true};
    const mcp=await request('/mcp');assert.ok(mcp['fixture-disabled']);evidence.mcpEndpoint=true;evidence.projectSettings.mcp=true;
    const terminal=await request('/pty',{command:process.env.ComSpec,cwd:project,title:'Synthetic terminal verification'});
    assert.equal(terminal.status,'running');evidence.terminal=true;
    await request('/pty/'+terminal.id,undefined,'DELETE');
    const homeLinks=[];shell.openExternal=async url=>{homeLinks.push(url);};
    if(process.argv.includes('--links-only')){
      const session=await request('/session',{title:'Native configuration regression'});
      const route='/'+Buffer.from(project).toString('base64url')+'/session/'+session.id;
      await win.webContents.executeJavaScript(`window.api.getWindowID().then(id=>localStorage.setItem('opencode.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)}))`);
      const loaded=once(win.webContents,'did-finish-load');win.webContents.reload();await loaded;
      for(let i=0;i<150;i++){if(await win.webContents.executeJavaScript("!!document.querySelector('[contenteditable=true]')"))break;await sleep(100);}
      await sleep(600);
      const trigger=await win.webContents.executeJavaScript("(()=>{const b=[...document.querySelectorAll('button')].find(e=>/^GPT-6/.test(e.innerText.trim()));if(!b)return null;const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
      assert.ok(trigger);for(const type of ['mouseDown','mouseUp'])win.webContents.sendInputEvent({type,x:Math.round(trigger.x),y:Math.round(trigger.y),button:'left',clickCount:1});await sleep(400);
      const menu=await win.webContents.executeJavaScript('document.body.innerText');
      assert.ok(menu.includes('GPT-6.1 Sol')&&menu.includes('GPT-6 Sol'));assert.ok(!/Forbidden external fixture|Connect provider|连接提供商/.test(menu));
      evidence.modelMenu=true;fs.writeFileSync(path.join(out,'model-selector.png'),(await win.webContents.capturePage()).toPNG());
      for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Escape'});await sleep(250);
      const account=await win.webContents.executeJavaScript("(()=>{document.querySelector('.botgo-account-trigger').click();const d=document.querySelector('.botgo-account-dialog');return {open:d?.open,actions:d?.querySelectorAll('.botgo-account-actions button').length}})()");
      assert.ok(account.open&&account.actions===3);evidence.account=true;await sleep(250);fs.writeFileSync(path.join(out,'account.png'),(await win.webContents.capturePage()).toPNG());
      await win.webContents.executeJavaScript("document.querySelector('.botgo-account-dialog').close()");
    }
    for(const protocol of (process.argv.includes('--links-only')?[]:process.argv.includes('--chat-only')?['chat']:['responses','chat']))for(const filename of ['text.pdf','scan.pdf','large.pdf']){
      const modelID=protocol==='responses'?'gpt-6.1-sol':'gpt-6-sol';
      const session=await request('/session',{title:`PDF ${protocol} ${filename}`,permission:[{permission:'*',pattern:'*',action:'deny'}]});
      const route='/'+Buffer.from(project).toString('base64url')+'/session/'+session.id;
      await win.webContents.executeJavaScript(`window.api.getWindowID().then(id=>localStorage.setItem('opencode.desktop.window.'+id+'.last-active-url',${JSON.stringify(route)}))`);
      const loaded=once(win.webContents,'did-finish-load');win.webContents.reload();await loaded;
      for(let i=0;i<150;i++){if(await win.webContents.executeJavaScript("!!document.querySelector('[contenteditable=true]')"))break;await sleep(100);}
      await sleep(600);
      const selection=await win.webContents.executeJavaScript(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>/^GPT-6/.test(b.innerText.trim())&&!b.closest('[role=dialog]'));if(!button)return null;const r=button.getBoundingClientRect();return {name:button.innerText.trim(),x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      assert.ok(selection,'native model picker trigger');
      if(selection.name!==(protocol==='responses'?'GPT-6.1 Sol':'GPT-6 Sol')){
        win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(selection.x),y:Math.round(selection.y),button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(selection.x),y:Math.round(selection.y),button:'left',clickCount:1});await sleep(400);
        const selected=await win.webContents.executeJavaScript(`(()=>{const choice=[...document.querySelectorAll('span,div,button')].find(e=>e.childElementCount===0&&e.textContent.trim()===${JSON.stringify(protocol==='responses'?'GPT-6.1 Sol':'GPT-6 Sol')}&&e.getBoundingClientRect().width>0);if(!choice)return {ok:false,text:document.body.innerText.slice(-2000)};const r=choice.getBoundingClientRect();return {ok:true,x:r.x+r.width/2,y:r.y+r.height/2}})()`);
        assert.ok(selected.ok,JSON.stringify(selected));win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(selected.x),y:Math.round(selected.y),button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(selected.x),y:Math.round(selected.y),button:'left',clickCount:1});await sleep(250);
      }
      if(!win.webContents.debugger.isAttached())win.webContents.debugger.attach('1.3');
      const {root:dom}=await win.webContents.debugger.sendCommand('DOM.getDocument');
      const {nodeId}=await win.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:dom.nodeId,selector:'input[type=file]'});
      assert.ok(nodeId,'native file attachment input');
      await win.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId,files:[path.join(fixtures,filename)]});
      let attached=false;for(let i=0;i<150;i++){attached=await win.webContents.executeJavaScript(`document.querySelector('[data-slot="prompt-attachments"]')?.innerText.includes(${JSON.stringify(filename)})===true`);if(attached)break;await sleep(100);}
      assert.ok(attached,'PDF must render in the native attachment tray');
      const prompt='Read the attached PDF and return only the verification token printed on the first page. Do not guess or call tools.';
      await win.webContents.executeJavaScript(`(()=>{const editor=document.querySelector('[contenteditable=true]');editor.focus();document.execCommand('insertText',false,${JSON.stringify(prompt)})})()`);
      fs.writeFileSync(path.join(out,`${protocol}-${filename}-attached.png`),(await win.webContents.capturePage()).toPNG());
      win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
      let answer,messages;
      for(let i=0;i<1800;i++){
        messages=await request(`/session/${session.id}/message`);
        answer=messages.find(m=>m.info.role==='assistant'&&(m.info.error||m.info.time?.completed));
        if(answer)break;await sleep(100);
      }
      assert.ok(answer,'native answer timeout');assert.ok(!answer.info.error,JSON.stringify(answer.info.error));
      const text=answer.parts.filter(p=>p.type==='text').map(p=>p.text).join('\n');
      const expected=manifest[filename].token;assert.ok(text.includes(expected),`PDF token mismatch ${protocol}/${filename}: ${text}`);
      const user=messages.find(m=>m.info.role==='user');assert.ok(user.parts.some(p=>p.type==='file'&&p.mime==='application/pdf'&&path.basename(p.filename)===filename));
      evidence.uploads.push({protocol,filename,bytes:fs.statSync(path.join(fixtures,filename)).size,tokenMatched:true,sessionId:session.id,model:answer.info.modelID,usage:answer.info.tokens});
      await sleep(300);fs.writeFileSync(path.join(out,`${protocol}-${filename}-answer.png`),(await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify(evidence.uploads.at(-1)));
    }
    for(let i=0;i<100;i++){if(await win.webContents.executeJavaScript("!!document.querySelector('[data-botgo-home]')"))break;await sleep(100);}
    await win.webContents.executeJavaScript("document.querySelector('[data-botgo-home]').click()");evidence.homeLinks=homeLinks;assert.equal(homeLinks.length,1);assert.equal(new URL(homeLinks[0]).origin,'https://botgo.win');evidence.logoLink=true;
    await finish();
  }catch(error){await finish(error);}
}));
(async()=>{
  const input=process.env.BOTGO_TEST_KEY_PIPE?require('node:net').createConnection(process.env.BOTGO_TEST_KEY_PIPE):process.stdin;
  if(input.isTTY)input.setRawMode(true);
  const rl=readline.createInterface({input,terminal:false});console.log('READY_FOR_KEY_STDIN');key=await new Promise((resolve,reject)=>{rl.once('line',resolve);input.once('error',reject);});rl.close();
  assert.match(key,/^sk-[A-Za-z0-9_-]+$/);
  const price={input:2,output:10,cached:.2,write:2.5};
  bridge=await createBridge({origin:'https://fixture.invalid',deviceToken:'bgdt_fixture',initialSession:{key:'bgk_fixture',defaultModel:'gpt-6.1-sol',account:{email:'fixture@invalid',balanceMicros:12000000},models:[['gpt-6.1-sol','responses'],['gpt-6-sol','chat']].map(([id,protocol])=>({id,name:protocol==='responses'?'GPT-6.1 Sol':'GPT-6 Sol',protocol,price,multiplier:.3,modalities:{input:['text','image','pdf'],output:['text']},attachment:true,reasoning:true,limit:{context:1050000,output:128000}}))},fetchImpl:async(url,init)=>{
    const body=JSON.parse(init.body),protocol=url.endsWith('/responses')?'responses':'chat';
    const parts=protocol==='responses'?body.input.flatMap(i=>i.content||[]):body.messages.flatMap(i=>Array.isArray(i.content)?i.content:[]);
    const files=parts.filter(p=>p.type==='input_file'||p.type==='file');
    const item={protocol,model:body.model,filenames:files.map(p=>p.filename||p.file?.filename),fileBytes:files.map(p=>(p.file_data||p.file?.file_data||'').length),taskId:init.headers['x-botgo-task-id']};
    // Exact screenshot model on both upstream protocols; local Chat alias keeps
    // the session catalog unique without changing or publishing any real route.
    body.model='gpt-6.1-sol';
    evidence.requests.push(item);
    const response=await fetch('https://kedaya.ai/v1/'+(protocol==='responses'?'responses':'chat/completions'),{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify(body),signal:init.signal});
    item.status=response.status;
    if(!response.ok){const raw=await response.text();item.error=scrub(raw.slice(0,1000));return new Response(raw,{status:response.status,headers:response.headers});}
    return response;
  }});
  process.env.BOTGO_MANAGED_CONFIG=JSON.stringify(bridge.config());
  process.env.OPENCODE_CONFIG_CONTENT=process.env.BOTGO_MANAGED_CONFIG;
  await import(pathToFileURL(path.join(desktop,'out/main/index.js')).href);
})().catch(finish);
