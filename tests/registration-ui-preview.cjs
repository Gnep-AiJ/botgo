// Isolated public registration fixture. No mail is sent.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts/verification/registration-ui');fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();
let signedIn=false;const calls=[];
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/')){res.setHeader('content-type','application/json');calls.push(u.pathname);
  if(u.pathname==='/api/auth/request-login-code')return res.end('{"ok":true}');
  if(u.pathname==='/api/auth/login'){signedIn=true;return res.end(JSON.stringify({account:{email:'new@example.invalid',credits:0,balance:0}}));}
  if(u.pathname==='/api/account'){if(!signedIn)res.statusCode=401;return res.end(signedIn?'{"account":{"email":"new@example.invalid","credits":0}}':'{"error":"请先登录"}');}
  if(u.pathname==='/api/models')return res.end('{"defaultModel":"test","models":[{"id":"test","name":"Test","enabled":true,"web":true}]}');
  if(u.pathname==='/api/conversations')return res.end('{"conversations":[],"hasMore":false}');
  return res.end('{}');
 }
 const allowed=new Set(['/workspace.html','/workspace.css','/workspace.js','/workspace-billing.js','/ui-kit.js','/ui-kit.css','/agent-install.js']);
 if(!allowed.has(u.pathname)&&!/^\/assets\/[a-zA-Z0-9_-]+\.webp$/.test(u.pathname)){res.statusCode=404;return res.end();}
 const file=path.resolve(root,'.'+decodeURIComponent(u.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;return res.end();}
 res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'application/octet-stream');res.end(fs.readFileSync(file));
});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{let win;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));win=new BrowserWindow({width:1100,height:850,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.showInactive();
 const run=js=>win.webContents.executeJavaScript(js,true),until=async js=>{for(let i=0;i<60;i++){if(await run(js))return;await pause(50);}throw Error('Timed out '+js);};
 await win.loadURL('http://127.0.0.1:'+server.address().port+'/workspace.html');await pause(250);
 await run("document.querySelector('#register-button').click()");assert.equal(await run("!!document.querySelector('[name=inviteCode]')"),false);
 await run("document.querySelector('#register-email').value='new@example.invalid';document.querySelector('#register-form').requestSubmit()");await until("!document.querySelector('#verify-form').hidden");
 fs.writeFileSync(path.join(out,'email-verification.png'),(await win.webContents.capturePage()).toPNG());
 await run("document.querySelector('#verification-code').value='123456';document.querySelector('#verify-form').requestSubmit()");await until("!document.querySelector('#auth-dialog').open");
 assert(calls.includes('/api/auth/request-login-code'));assert(calls.includes('/api/auth/login'));assert(!calls.some(x=>x.includes('invite')||x.includes('verify-email')));
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({ok:true,verifiedAt:new Date().toISOString(),calls},null,2));console.log('Open registration browser flow passed');win.destroy();server.close();setTimeout(()=>app.exit(0),300);
 }catch(e){fs.writeFileSync(path.join(out,'failure.txt'),e.stack);console.error(e);win?.destroy();server.close();setTimeout(()=>app.exit(1),300);}});
