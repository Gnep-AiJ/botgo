// Actual Chromium rendering against local fixtures. No production login or payment.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts/verification/opencode-ui');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const price={input:4,cached:.4,write:5,output:20,longThreshold:272000,longInput:2,longOutput:1.5,source:'https://developers.openai.com/api/docs/pricing',date:'2026-09-12',tier:'default'};
const model={id:'gpt-5.6-sol',name:'GPT-5.6 Sol',upstream_id:'gpt-5.6-sol',price,enabled:1,web_enabled:1,agent_enabled:1,multiplier_ppm:null};
let saved=null;const requests=[],errors=[];
const fixture={
  '/api/admin/overview':{admin:{email:'fixture@example.invalid'},overview:{accounts:1,active:1,pendingVerifications:0}},
  '/api/admin/accounts':{accounts:[],page:1,pages:1},
  '/api/admin/upstreams':{upstreams:[{id:'fixture',name:'测试上游',baseUrl:'https://upstream.invalid/v1',probes:[],assignedChannels:[]}]},
  '/api/admin/routes':{routes:[]},'/api/admin/desktop/releases':{releases:[]},
  '/api/admin/metering':{settings:{multiplier_ppm:300000,usd_cny_ppm:7000000,default_model:model.id},models:[model],ledger:[]},
};
const server=http.createServer(async(req,res)=>{
 const pathname=new URL(req.url,'http://127.0.0.1').pathname;
 if(pathname.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   if(req.method==='PUT' && pathname==='/api/admin/opencode/models/'+model.id){let data='';for await(const chunk of req)data+=chunk;saved=JSON.parse(data);requests.push({path:pathname,body:saved});res.end('{"ok":true}');return;}
   if(pathname==='/api/admin/opencode'){res.end(JSON.stringify({routes:saved?[{model_id:model.id,profile_id:saved.profileId,protocol:saved.protocol,enabled:0,verified_at:null}]:[]}));return;}
   res.end(JSON.stringify(fixture[pathname]||{}));return;
 }
 const file=path.resolve(root,'.'+decodeURIComponent(pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
 res.setHeader('content-type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1440,height:900,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
 const run=js=>win.webContents.executeJavaScript(js,true);
 const until=async js=>{for(let i=0;i<60;i++){if(await run(js))return;await sleep(50);}throw Error('UI timeout: '+js);};
 const shot=async name=>{await sleep(150);fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());};
 try{
   await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
   const checks=[];
   for(const width of [1440,390,360])for(const theme of ['light','dark']){
     win.setContentSize(width,900);await win.loadURL(origin+'/workspace.html?preview=chat');
     await until("document.body.dataset.activeView==='chat'");
     await run(`if(document.documentElement.dataset.theme!=='${theme}')document.querySelector('#theme-toggle').click()`);
     await shot(`welcome-${width}-${theme}`);
     await run("document.querySelector('#chat-input').value='展示代码示例';document.querySelector('#chat-input').dispatchEvent(new Event('input'));document.querySelector('#chat-form').requestSubmit()");
     await until("document.querySelectorAll('.message-body pre code').length>0");
     const bounds=await run("(()=>{const r=document.querySelector('#chat-form').getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth,height:innerHeight}})()");
     assert.equal(bounds.overflow,false);assert.ok(bounds.left>=0&&bounds.right<=width&&bounds.bottom<=bounds.height,JSON.stringify(bounds));
     await run("document.querySelector('#model-picker').click()");
     await until("document.querySelector('.botgo-menu:not([hidden])')!==null");
     await run("document.querySelector('.botgo-menu:not([hidden])').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
     assert.equal(await run('document.activeElement.id'),'model-picker');
     await shot(`chat-${width}-${theme}`);checks.push({width,theme,bounds,markdown:true,keyboard:true});
   }
   win.setContentSize(1440,900);await win.loadURL(origin+'/admin.html#metering');
   await until("document.querySelector('#meter-opencode form')!==null");
   await run("[...document.querySelectorAll('.meter-tabs button')].find(b=>b.textContent==='OpenCode 渠道').click()");
   await shot('admin-opencode');
   await run("document.querySelector('#meter-opencode form').requestSubmit()");
   await until("document.querySelector('#meter-opencode [data-status]').textContent.includes('操作完成')");
   assert.equal(saved.profileId,'fixture');assert.equal(saved.protocol,'chat');assert.equal(saved.enabled,false);
   win.setContentSize(390,900);await shot('admin-opencode-mobile');
   assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
   assert.deepEqual(errors,[]);
   fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({checks,requests,errors},null,2));
   console.log(JSON.stringify({ok:true,checks:checks.length,adminSave:true,artifacts:out}));win.destroy();server.close();app.exit(0);
 }catch(error){fs.writeFileSync(path.join(out,'failure.txt'),error.stack);console.error(error);win.destroy();server.close();app.exit(1);}
});
