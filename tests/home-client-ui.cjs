const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'..'),phase=process.argv.includes('--before')?'before':process.argv.includes('--release')?'release':'after';
const webRoot=phase==='release'?path.join(root,'artifacts/verification/hermes-capabilities-20261023/site-release'):root;
const csp=phase==='release'?fs.readFileSync(path.join(webRoot,'_headers'),'utf8').match(/^  Content-Security-Policy: (.+)$/m)?.[1]:null;
const out=path.join(root,'artifacts/verification/botgo-web-refresh-20261024',phase);
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'browser'));
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://local');
  if(url.pathname.startsWith('/api/')){res.writeHead(401,{'content-type':'application/json'});return res.end('{}');}
  const file=path.resolve(webRoot,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
  if(!file.startsWith(webRoot+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}
  if(csp)res.setHeader('content-security-policy',csp);
  res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');
  fs.createReadStream(file).pipe(res);
 });
 let win;
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const report=[];
  for(const [label,width,height] of [['desktop',1440,1000],['mobile',390,844],['small',320,740]]){
   win=new BrowserWindow({width,height,useContentSize:true,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
   const securityErrors=[];
   win.webContents.on('console-message',(_event,_level,message)=>{if(typeof message==='string'&&/Refused to (execute|load|apply)|violates.*(script-src|style-src)/i.test(message))securityErrors.push(message);});
   win.webContents.setBackgroundThrottling(false);
   await win.loadURL('http://127.0.0.1:'+server.address().port+'/');
   await win.webContents.executeJavaScript('Promise.race([Promise.all(Array.from(document.images).filter(i=>i.loading!=="lazy").map(i=>i.decode().catch(()=>{}))),new Promise(r=>setTimeout(r,3000))])');
   win.showInactive();await new Promise(r=>setTimeout(r,350));
   fs.writeFileSync(path.join(out,label+'-hero.png'),(await win.webContents.capturePage()).toPNG());
   const layout=await win.webContents.executeJavaScript(`({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,logo:!!document.querySelector('.brand img'),download:document.querySelector('[data-download]')?.getBoundingClientRect().toJSON(),headers:[...document.querySelectorAll('.site-header a,.site-header button')].map(e=>({text:e.innerText,w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height})),oldClientImages:[...document.querySelectorAll('#product img')].some(i=>i.src.includes('-original'))})`);
   if(phase!=='before'&&!await win.webContents.executeJavaScript("document.querySelector('#hero-title').innerText.includes('让想法有回响')"))throw Error('Original hero changed');
   await win.webContents.executeJavaScript("document.querySelector('#product').scrollIntoView({behavior:'instant'}); Promise.all([...document.querySelectorAll('#product img')].map(i=>i.decode().catch(()=>{})))");
   if(phase!=='before'){
    const gallery=await win.webContents.executeJavaScript(`(async()=>{const tabs=[...document.querySelectorAll('[data-client-preview]')];tabs[0].dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));await document.querySelector('#client-preview-panel img').decode();const ok=tabs[1].getAttribute('aria-selected')==='true'&&new URL(document.querySelector('#client-preview-panel img').src).pathname.endsWith('botgo-client-wechat.png');tabs[0].click();await document.querySelector('#client-preview-panel img').decode();return ok})()`);
    if(!gallery)throw Error('Client preview keyboard switching failed');
   }
   await new Promise(r=>setTimeout(r,250));
   fs.writeFileSync(path.join(out,label+'-client.png'),(await win.webContents.capturePage()).toPNG());
   if(phase!=='before'&&(layout.overflow||!layout.logo||layout.oldClientImages))throw Error('Homepage layout/branding acceptance failed: '+label);
   if(securityErrors.length){fs.writeFileSync(path.join(out,label+'-csp-errors.json'),JSON.stringify(securityErrors,null,2));throw Error('Production CSP blocked page resources');}
   report.push({label,...layout,securityErrors});win.destroy();win=null;
  }
  if(phase!=='before')for(const [label,width,height] of [['chat-desktop',1440,1000],['chat-mobile',390,844],['chat-small',320,740]]){
   win=new BrowserWindow({width,height,useContentSize:true,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
   await win.loadURL('http://127.0.0.1:'+server.address().port+'/chat.html');
   await win.webContents.executeJavaScript('Promise.all([...document.querySelectorAll(".brand img")].map(i=>i.decode()))');
   win.showInactive();await new Promise(r=>setTimeout(r,350));
   const layout=await win.webContents.executeJavaScript('({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,logo:!!document.querySelector(".brand-bot-mark img")?.naturalWidth})');
   if(layout.overflow||!layout.logo)throw Error('Chat header/layout acceptance failed: '+label);
   fs.writeFileSync(path.join(out,label+'.png'),(await win.webContents.capturePage()).toPNG());report.push({label,...layout});win.destroy();win=null;
  }
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:true,phase,report},null,2));
 }catch(error){console.error(error.stack);process.exitCode=1;}
 finally{win?.destroy();server.closeAllConnections();server.close();app.exit(process.exitCode||0);}
});
