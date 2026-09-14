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
app.setAppPath(desktop);
app.setPath('userData',path.join(evidence,'profile'));
app.setPath('sessionData',path.join(evidence,'chromium'));
app.setPath('crashDumps',path.join(evidence,'crashes'));
process.env.BOTGO_PROFILE_ROOT=path.join(evidence,'profile');
process.env.OPENCODE_CONFIG_CONTENT=JSON.stringify({enabled_providers:[],share:'disabled',autoupdate:false});
process.env.OPENCODE_DISABLE_MODELS_FETCH='true';
process.env.OPENCODE_DISABLE_AUTOUPDATE='true';
process.env.OPENCODE_SIDECAR_V2='0';
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
        const state=await win.webContents.executeJavaScript(`({title:document.title,text:document.body.innerText,logo:!!document.querySelector('[aria-label="BotGo"]')})`);
        if(state.text.trim().length>20){
          await new Promise(resolve=>setTimeout(resolve,600));
          fs.writeFileSync(path.join(evidence,'desktop.png'),(await win.webContents.capturePage()).toPNG());
          clearTimeout(timer);
          const internalCopy=/设备凭据由 Windows|上游 API 密钥|Device credentials are protected|Upstream API keys stay/.test(state.text);
          finish(state.logo&&state.title==='BotGo'&&!internalCopy&&errors.length===0,{...state,text:state.text.slice(0,1500)});
          return;
        }
        await new Promise(resolve=>setTimeout(resolve,500));
      }
      finish(false,'Renderer remained empty');
    }catch(error){finish(false,scrub(error.stack));}
  });
});
import(pathToFileURL(path.join(desktop,'out/main/index.js')).href).catch(error=>finish(false,scrub(error.stack)));
