// Launch the real built desktop in an isolated profile, without inference credentials.
const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const desktop=path.join(root,'artifacts/opencode/packages/desktop');
const evidence=process.env.BOTGO_SMOKE_OUTPUT||path.join(root,'artifacts/verification/opencode-native',String(Date.now()));
if(!path.resolve(evidence).startsWith(path.join(root,'artifacts/verification/opencode-native')+path.sep))throw Error('Invalid evidence directory');
fs.mkdirSync(evidence,{recursive:true});
// The isolated Windows runner may not expose the system GPU runtime. Rendering
// the product UI does not require acceleration, so verify the software path.
app.disableHardwareAcceleration();
app.setAppPath(desktop);
app.setPath('userData',path.join(evidence,'profile'));
app.setPath('sessionData',path.join(evidence,'chromium'));
app.setPath('crashDumps',path.join(evidence,'crashes'));
process.env.BOTGO_PROFILE_ROOT=path.join(evidence,'profile');
process.env.OPENCODE_CONFIG_CONTENT=JSON.stringify({enabled_providers:[],share:'disabled',autoupdate:false});
process.env.OPENCODE_DISABLE_MODELS_FETCH='true';
process.env.OPENCODE_DISABLE_AUTOUPDATE='true';
process.env.OPENCODE_SIDECAR_V2='0';
process.env.BOTGO_NATIVE_SMOKE='1';
const errors=[];
const scrub=value=>String(value).replace(/(?:sk-|bgdt_|bgk_)[A-Za-z0-9_-]+/g,'[redacted]');
let finished=false;
function finish(ok,detail){
  if(finished)return;
  finished=true;
  fs.writeFileSync(path.join(evidence,'result.json'),JSON.stringify({ok,detail,errors},null,2));
  console.log(JSON.stringify({ok,evidence,detail,errors}));
  app.exit(ok?0:1);
}
process.on('uncaughtException',e=>finish(false,scrub(e.stack)));
process.on('unhandledRejection',e=>finish(false,scrub(e?.stack||e)));
const timer=setTimeout(()=>finish(false,'Native desktop did not render within 90 seconds'),90000);
app.on('child-process-gone',(_e,d)=>errors.push({type:d.type,reason:d.reason,exitCode:d.exitCode}));
app.on('browser-window-created',(_e,win)=>{
  win.webContents.on('render-process-gone',(_event,d)=>finish(false,d));
  win.webContents.on('did-fail-load',(_event,code,description)=>finish(false,{code,description}));
  win.webContents.on('console-message',(_event,details)=>{
    if(details.level==='error')errors.push(scrub(details.message));
  });
  win.webContents.on('did-finish-load',async()=>{
    try{
      for(let attempt=0;attempt<50;attempt++){
        const state=await win.webContents.executeJavaScript(`(()=>({
          title:document.title,
          text:document.body.innerText,
          logo:!!document.querySelector('[data-component="botgo-wordmark"]'),
          account:!!document.querySelector('.botgo-account-trigger'),
          selector:[...document.querySelectorAll('button')].some((item)=>/^(?:选择模型|Select model)/.test(item.innerText.trim()))
        }))()`);
        if(state.logo&&state.account&&state.selector){
          await new Promise(resolve=>setTimeout(resolve,600));
          fs.writeFileSync(path.join(evidence,'desktop.png'),(await win.webContents.capturePage()).toPNG());
          const selector=await win.webContents.executeJavaScript(`(()=>{
            const button=[...document.querySelectorAll('button')].find((item)=>/^(?:选择模型|Select model)/.test(item.innerText.trim()))
            if(!button)return {opened:false}
            button.click()
            return {opened:true}
          })()`);
          await new Promise(resolve=>setTimeout(resolve,250));
          const modelMenu=await win.webContents.executeJavaScript(`({text:document.body.innerText})`);
          fs.writeFileSync(path.join(evidence,'model-selector.png'),(await win.webContents.capturePage()).toPNG());
          await win.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}))`);
          await new Promise(resolve=>setTimeout(resolve,250));
          const account=await win.webContents.executeJavaScript(`(()=>{
            const trigger=document.querySelector('.botgo-account-trigger')
            if(!(trigger instanceof HTMLButtonElement))return {opened:false}
            trigger.click()
            const dialog=document.querySelector('.botgo-account-dialog')
            return {opened:dialog instanceof HTMLDialogElement&&dialog.open,actions:dialog?.querySelectorAll('.botgo-account-actions button').length??0,text:dialog?.innerText??''}
          })()`);
          fs.writeFileSync(path.join(evidence,'account.png'),(await win.webContents.capturePage()).toPNG());
          clearTimeout(timer);
          const internalCopy=/设备凭据由 Windows|上游 API 密钥|Device credentials are protected|Upstream API keys stay/.test(state.text);
          const providerAction=/(?:连接提供商|Connect provider|Add provider|Custom provider)/i.test(modelMenu.text);
          finish(state.logo&&state.account&&state.title==='BotGo'&&selector.opened&&account.opened&&account.actions===3&&account.text.includes('¥12.00')&&!internalCopy&&!providerAction&&errors.length===0,{...state,text:state.text.slice(0,1500),modelMenu:{...modelMenu,text:modelMenu.text.slice(0,1500),account}});
          return;
        }
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      finish(false,'Renderer remained empty');
    }catch(error){finish(false,scrub(error.stack));}
  });
});
import(pathToFileURL(path.join(desktop,'out/main/index.js')).href).catch(error=>finish(false,scrub(error.stack)));
