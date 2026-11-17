// Owns only a fresh fixture profile. No installed account or paid inference.
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');
const {app,BrowserWindow}=require('electron');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
async function settleFrame(win){if(!win.isVisible())win.showInactive();await win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await new Promise(resolve=>setTimeout(resolve,250));const text=await win.webContents.executeJavaScript('document.body.innerText');if(/\bHermes\b|\bOpenCode\b|Nous Research/i.test(text))throw Error('Non-BotGo branding is visible');}
const root=path.resolve(__dirname,'..');
const packagedRuntime=process.argv.includes('--packaged-runtime');
const resources=process.argv.includes('--installed-runtime')?path.join(root,'artifacts/verification/botgo-installed-v5/resources'):path.join(root,'artifacts/releases/hermes-preview-polish/win-unpacked/resources');
const payload=path.join(resources,'hermes-payload');
const source=packagedRuntime?path.join(payload,'hermes-agent'):path.join(root,'artifacts/hermes');
const desktop=packagedRuntime?path.join(resources,'app.asar'):path.join(source,'apps/desktop');
app.setAppPath(desktop);
const profile=path.join(root,'artifacts/verification/hermes-electron/'+Date.now());fs.mkdirSync(profile,{recursive:true});
process.env.BOTGO_PROFILE_ROOT=profile;process.env.HERMES_HOME=path.join(profile,'pending');
process.env.HERMES_DESKTOP_USER_DATA_DIR=path.join(profile,'chromium');
process.env.HERMES_RUNTIME_DIR=packagedRuntime?path.join(payload,'tools'):path.join(root,'artifacts/hermes-tools');
process.env.HERMES_DESKTOP_PYTHON=packagedRuntime?path.join(payload,JSON.parse(fs.readFileSync(path.join(payload,'runtime.json'),'utf8')).python):path.join(root,'artifacts/hermes-python/Scripts/python.exe');
if(packagedRuntime){process.env.PYTHONPATH=[source,path.join(payload,'venv/Lib/site-packages')].join(path.delimiter);process.env.PYTHONNOUSERSITE='1';}
process.env.HERMES_DESKTOP_HERMES_ROOT=source;process.env.HERMES_DESKTOP_CWD=path.join(profile,'workspace');
process.env.HERMES_DESKTOP_CDP_PORT='off';process.env.HERMES_DESKTOP_APP_NAME='BotGo';
fs.mkdirSync(process.env.HERMES_DESKTOP_CWD,{recursive:true});
const fixture=process.argv.includes('--fixture');
let cloud;let failed=false;const captures=[];
let fixtureBalance=12000000;let fixtureAccountFailure=false;
async function finish(error){
  if(failed)return;failed=true;
  if(error){const main=BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&!w.webContents.getURL().includes('botgo-account.html'));if(main){fs.writeFileSync(path.join(profile,'failure-visible.txt'),await main.webContents.executeJavaScript('document.body.innerText').catch(()=>''));fs.writeFileSync(path.join(profile,'failure.png'),(await main.webContents.capturePage()).toPNG());}}
  fs.writeFileSync(path.join(profile,'result.json'),JSON.stringify({passed:!error,error:error?.message,captures},null,2));
  fs.writeFileSync(path.join(profile,'status.txt'),error?'ELECTRON_FAILED '+error.message:'ELECTRON_PASSED');
  cloud?.closeAllConnections();cloud?.close();
  // Stop only the fixture's canonical gateway, never a user-owned instance.
  if(fixture){const {spawn}=require('node:child_process');await new Promise(resolve=>{const child=spawn(process.env.HERMES_DESKTOP_PYTHON,['-m','hermes_cli.main','gateway','stop'],{cwd:source,env:process.env,windowsHide:true,stdio:'ignore'});child.once('exit',resolve);child.once('error',resolve);setTimeout(resolve,15000);});}
  app.exit(error?1:0);
}
app.on('browser-window-created',(_event,win)=>{
  win.webContents.setBackgroundThrottling(false);
  win.webContents.on('console-message',(_event,level,message)=>{if(level>=2)fs.appendFileSync(path.join(profile,'renderer-errors.log'),message.replace(/([?&](?:token|ticket|key)=)[^\s&]+/gi,'$1[redacted]')+'\n');});
  win.webContents.on('render-process-gone',(_event,details)=>void finish(Error('Renderer failed: '+details.reason)));
  win.webContents.on('did-finish-load',async()=>{
    if(fixture && win.webContents.getURL().includes('botgo-account.html'))return;
    try{
      for(let attempt=0;attempt<120;attempt++){
        if(win.isDestroyed())return;
        const text=await win.webContents.executeJavaScript('document.body.innerText');
        if(attempt % 15 === 0){fs.writeFileSync(path.join(profile,'last-visible-text.txt'),text);fs.writeFileSync(path.join(profile,'last-frame.png'),(await win.webContents.capturePage()).toPNG());}
        const login=text.includes('登录 BotGo');
        let connected=false;
        if(fixture&&!login){try{connected=await win.webContents.executeJavaScript("Promise.race([window.hermesDesktop.getConnection().then(c=>!!c.baseUrl&&!!c.wsUrl),new Promise(r=>setTimeout(()=>r(false),3000))])");}catch{}}
        if((!fixture&&login)||(fixture&&connected&&(/后端\s*就绪|Backend\s*ready/i.test(text)))){
          await new Promise(resolve=>setTimeout(resolve,2500));
          await settleFrame(win);const screenshot=await win.webContents.capturePage();const file=path.join(profile,fixture?'native.png':'login.png');fs.writeFileSync(file,screenshot.toPNG());captures.push(file);
          fs.writeFileSync(path.join(profile,'visible-text.txt'),await win.webContents.executeJavaScript('document.body.innerText'));
          const visible=await win.webContents.executeJavaScript('document.body.innerText');
          if(/分享使用统计|Share usage|放入文件路径|rough idea/.test(visible))throw Error('Removed homepage copy still rendered');
          if(fixture){const value=await win.webContents.executeJavaScript('window.botgo.state()');if(value.status!=='ready')throw Error('Account is not ready');
            const shortcut=await win.webContents.executeJavaScript("document.querySelector('.botgo-account-shortcut')?.innerText || ''");
            if(!shortcut.includes('¥12.0000'))throw Error('Quick balance unavailable');
            if(/技能与工具|Skills & Tools|Hermes|v2\.0\.0/.test(visible))throw Error('Removed navigation or footer branding still visible');
            await win.webContents.executeJavaScript("document.querySelector('.botgo-account-shortcut').click()");
            for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,300));if(await win.webContents.executeJavaScript("!!document.querySelector('[data-testid=account-balance]')"))break;}
            let refreshReady=false;for(let i=0;i<30;i++){refreshReady=await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).some(e=>e.innerText.trim()==='刷新余额'&&!e.disabled)");if(refreshReady)break;await new Promise(r=>setTimeout(r,200));}
            if(!refreshReady)throw Error('Balance refresh did not become actionable');
            fixtureBalance=10750000;
            await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(e=>e.innerText.trim()==='刷新余额')?.click()");
            let refreshed=false;for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,300));refreshed=await win.webContents.executeJavaScript("document.querySelector('[data-testid=account-balance]')?.innerText==='¥10.7500' && document.querySelector('.botgo-account-shortcut')?.innerText.includes('¥10.7500')");if(refreshed)break;}
            if(!refreshed)throw Error('Balance refresh did not propagate');
            fixtureAccountFailure=true;
            await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(e=>e.innerText.trim()==='刷新余额')?.click()");
            await new Promise(r=>setTimeout(r,800));
            if(!await win.webContents.executeJavaScript("!!document.querySelector('.botgo-feedback')?.innerText && document.querySelector('[data-testid=account-balance]')?.innerText==='¥10.7500'"))throw Error('Account error lost previous balance or feedback');
            fixtureAccountFailure=false;
            await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(e=>e.innerText.trim()==='刷新余额')?.click()");
            await new Promise(r=>setTimeout(r,500));
            await settleFrame(win);const accountShot=path.join(profile,'account.png');fs.writeFileSync(accountShot,(await win.webContents.capturePage()).toPNG());captures.push(accountShot);
            await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(e=>e.innerText.trim()==='管理账户')?.click()");
            await new Promise(r=>setTimeout(r,1200));
            const accountWin=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('botgo-account.html'));
            if(!accountWin)throw Error('Account manager unavailable');
            accountWin.showInactive();
            for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,300));if(!accountWin.webContents.isLoading() && await accountWin.webContents.executeJavaScript("document.body.dataset.mode==='account' && document.querySelector('#balance')?.innerText==='¥10.7500'"))break;}
            await new Promise(r=>setTimeout(r,700));
            const accountImage=await accountWin.webContents.capturePage();if(accountImage.isEmpty())throw Error('Account window did not paint');
            const accountWindowShot=path.join(profile,'account-window.png');fs.writeFileSync(accountWindowShot,accountImage.toPNG());captures.push(accountWindowShot);accountWin.close();
            await win.webContents.executeJavaScript("window.location.hash='#/'");await new Promise(r=>setTimeout(r,700));
            fs.writeFileSync(path.join(profile,'account-state.json'),JSON.stringify(value,null,2));
            const picker=await win.webContents.executeJavaScript("(()=>{const b=Array.from(document.querySelectorAll('button')).find(e=>/gpt61sol/i.test(e.innerText.replace(/[^a-z0-9]/ig,'')));if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
            if(!picker)throw Error('Model picker unavailable');
            win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...picker});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...picker});
            await new Promise(r=>setTimeout(r,700));
            let pickerText=await win.webContents.executeJavaScript('document.body.innerText');
            if(/添加自定义模型|Add custom model/.test(pickerText))throw Error('Custom model entry still offered');
            const edit=await win.webContents.executeJavaScript("(()=>{const b=Array.from(document.querySelectorAll('[role=menuitem],button')).find(e=>/编辑模型|Edit models/i.test(e.innerText));b?.click();return !!b})()");
            if(!edit && !await win.webContents.executeJavaScript("!!document.querySelector('[role=dialog] input')")){fs.writeFileSync(path.join(profile,'picker-diagnostic.txt'),pickerText);fs.writeFileSync(path.join(profile,'picker-diagnostic.png'),(await win.webContents.capturePage()).toPNG());throw Error('Model search unavailable');}
            await new Promise(r=>setTimeout(r,700));
            await win.webContents.executeJavaScript("(()=>{const input=document.querySelector('[role=dialog] input');if(!input)throw Error('Edit Models search unavailable');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'foreign-model-not-in-catalog');input.dispatchEvent(new Event('input',{bubbles:true}))})()");
            await new Promise(r=>setTimeout(r,500));
            pickerText=await win.webContents.executeJavaScript('document.body.innerText');
            if(/添加自定义模型|Add custom model/.test(pickerText))throw Error('Edit Models offers custom model entry');
            win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
            await new Promise(r=>setTimeout(r,500));
            await win.webContents.executeJavaScript("(()=>{const d=document.querySelector('[role=dialog]');if(d){const b=d.querySelector('[data-slot=dialog-close]')||Array.from(d.querySelectorAll('button')).find(b=>/^(关闭|Close)$/.test(b.innerText.trim())||/^(关闭|Close)$/.test(b.getAttribute('aria-label')||''));b?.click()}})()");
            for(let i=0;i<20;i++){if(!await win.webContents.executeJavaScript("!!document.querySelector('[role=dialog]')"))break;await new Promise(r=>setTimeout(r,200));}
            if(await win.webContents.executeJavaScript("!!document.querySelector('[role=dialog]')"))throw Error('Model dialog did not close before navigation');
            const messagingTarget=await win.webContents.executeJavaScript("(()=>{const b=Array.from(document.querySelectorAll('button,a')).find(e=>/^(Messaging|消息平台)$/.test(e.innerText.trim())&&e.getBoundingClientRect().width>0);if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),html:b.outerHTML,hash:location.hash}})()");
            if(!messagingTarget)throw Error('Messaging navigation is unavailable');
            fs.writeFileSync(path.join(profile,'messaging-target.json'),JSON.stringify(messagingTarget,null,2));
            win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:messagingTarget.x,y:messagingTarget.y});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:messagingTarget.x,y:messagingTarget.y});
            let messaging=false;for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,500));messaging=await win.webContents.executeJavaScript("['WeChat','QQ Bot','Email'].every(t=>document.body.innerText.includes(t))");if(messaging)break;}
            if(!messaging)throw Error('Curated messaging platforms did not render');
            const messageText=await win.webContents.executeJavaScript('document.body.innerText');
            if(/Telegram|Discord|ClawBot|WhatsApp|Slack/.test(messageText))throw Error('Removed messaging platform or banner still visible');
            await win.webContents.executeJavaScript("(()=>{const b=Array.from(document.querySelectorAll('button,a,[role=button]')).find(e=>e.innerText.trim()==='WeChat');b?.click()})()");
            await new Promise(r=>setTimeout(r,800));
            if(!await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).some(b=>b.innerText.trim()==='扫码连接')"))throw Error('Native WeChat scan setup unavailable');
            await settleFrame(win);const weixin=path.join(profile,'weixin.png');fs.writeFileSync(weixin,(await win.webContents.capturePage()).toPNG());captures.push(weixin);
            await win.webContents.executeJavaScript("window.location.hash='#/settings?tab=config:model'");
            await new Promise(r=>setTimeout(r,2500));
            await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b=>b.innerText.trim()==='模型')?.click()");
            for(let i=0;i<30;i++){if(await win.webContents.executeJavaScript("!!document.querySelector('#botgo-model')"))break;await new Promise(r=>setTimeout(r,300));}
            const settingsText=await win.webContents.executeJavaScript('document.body.innerText');
            fs.writeFileSync(path.join(profile,'settings-text.txt'),settingsText);
            if(!settingsText.includes('默认模型'))throw Error('Managed model settings did not render');
            if(/自定义端点|Custom endpoints|GPT-Live|Nous Portal/.test(settingsText))throw Error('External provider surface still visible');
            let modelCount=0;for(let i=0;i<30;i++){modelCount=await win.webContents.executeJavaScript("document.querySelector('#botgo-model')?.options.length||0");if(modelCount)break;await new Promise(r=>setTimeout(r,500));}
            if(!modelCount){const catalog=await win.webContents.executeJavaScript("window.hermesDesktop.api({path:'/api/model/options?explicit_only=1'}).then(r=>r.providers.map(p=>({slug:p.slug,models:p.models})))");fs.writeFileSync(path.join(profile,'catalog-diagnostic.json'),JSON.stringify(catalog));throw Error('Managed model list is empty');}
            await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(e=>e.innerText.trim()==='保存')?.click()");
            let saved=false;for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,500));saved=await win.webContents.executeJavaScript("document.body.innerText.includes('已保存')");if(saved)break;}
            if(!saved)throw Error('Managed model could not be saved');
            await settleFrame(win);const settings=path.join(profile,'settings.png');fs.writeFileSync(settings,(await win.webContents.capturePage()).toPNG());captures.push(settings);
            await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b=>b.innerText.trim()==='记忆')?.click()");await new Promise(r=>setTimeout(r,1500));
            await settleFrame(win);const memory=path.join(profile,'memory.png');fs.writeFileSync(memory,(await win.webContents.capturePage()).toPNG());captures.push(memory);
            let folded=false;for(let i=0;i<30;i++){folded=await win.webContents.executeJavaScript("!!document.querySelector('.botgo-advanced-fields > button[aria-expanded=false]') && !document.querySelector('#botgo-advanced-body')");if(folded)break;await new Promise(r=>setTimeout(r,300));}
            if(!folded)throw Error('Advanced defaults not collapsed');
            await win.webContents.executeJavaScript("document.querySelector('.botgo-advanced-fields > button').click()");
            await new Promise(r=>setTimeout(r,300));
            if(!await win.webContents.executeJavaScript("!!document.querySelector('#botgo-advanced-body')"))throw Error('Advanced options cannot open');
            await win.webContents.executeJavaScript("document.querySelector('.botgo-advanced-fields > button').click()");
            await new Promise(r=>setTimeout(r,300));
            if(await win.webContents.executeJavaScript("!!document.querySelector('#botgo-advanced-body')"))throw Error('Advanced options cannot close');
            await settleFrame(win);fs.writeFileSync(memory,(await win.webContents.capturePage()).toPNG());
            await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('button')).find(b=>b.innerText.trim()==='关于')?.click()");await new Promise(r=>setTimeout(r,1000));
            if(await win.webContents.executeJavaScript("/Hermes/.test(document.body.innerText)"))throw Error('About still shows upstream brand');
            await win.webContents.executeJavaScript("window.location.hash='#/'");await new Promise(r=>setTimeout(r,700));
            const bots=await win.webContents.executeJavaScript("(()=>{const b=Array.from(document.querySelectorAll('[role=tab]')).find(b=>b.innerText.trim()==='机器人');if(!b)return null;const r=b.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
            if(!bots)throw Error('Bot navigation unavailable');
            win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...bots});win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...bots});
            await new Promise(r=>setTimeout(r,1000));await settleFrame(win);
            if(!await win.webContents.executeJavaScript("Array.from(document.querySelectorAll('[role=tab]')).some(b=>b.innerText.trim()==='机器人'&&(b.getAttribute('aria-selected')==='true'||b.dataset.state==='active'))"))throw Error('Bot workspace did not activate');
            const botsShot=path.join(profile,'bots.png');fs.writeFileSync(botsShot,(await win.webContents.capturePage()).toPNG());captures.push(botsShot);
          }
          await finish();return;
        }
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      throw Error('No usable native UI');
    }catch(error){void finish(error);}
  });
});
(async()=>{
  if(fixture){
    const crypto=require('node:crypto');const id=crypto.createHash('sha256').update('demo@botgo.win').digest('hex').slice(0,24);fs.writeFileSync(path.join(profile,'active-account.json'),JSON.stringify({id}));process.env.HERMES_HOME=path.join(profile,'accounts',id);
    cloud=http.createServer((req,res)=>{res.setHeader('content-type','application/json');
      if(req.url==='/api/desktop/opencode/session')return res.end(JSON.stringify({key:'bgk_fixture',defaultModel:'gpt-6.1-sol',account:{email:'demo@botgo.win',balanceMicros:12000000},models:[{id:'gpt-6.1-sol',name:'GPT-6.1-sol',protocol:'responses',price:{input:1,cached:0,write:0,output:1},multiplier:1,limit:{context:128000,output:8192}}]}));
      if(req.url==='/api/desktop/account'){if(fixtureAccountFailure){res.writeHead(503);return res.end('{}');}return res.end(JSON.stringify({account:{email:'demo@botgo.win',balanceMicros:fixtureBalance}}));}
      res.writeHead(503);res.end(JSON.stringify({error:'No inference in UI fixture'}));
    });await new Promise(resolve=>cloud.listen(0,'127.0.0.1',resolve));process.env.BOTGO_HERMES_UI_FIXTURE='1';process.env.BOTGO_HERMES_FIXTURE_ORIGIN=`http://127.0.0.1:${cloud.address().port}`;
  }
  const {pathToFileURL}=require('node:url');await import(pathToFileURL(path.join(desktop,'dist/electron-main.mjs')));
})().catch(error=>void finish(error));
setTimeout(()=>void finish(Error('Electron smoke timeout')),180000).unref();
