// Explicit user-authorized, bounded probes; credentials never leave this process
// except through the existing authenticated BotGo bridge.
const {app,safeStorage}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../..');
const out=path.join(root,'artifacts/verification/hermes-capabilities-20261023');
fs.mkdirSync(out,{recursive:true});
const probeProfile=path.join(out,'probe-electron');
fs.mkdirSync(probeProfile,{recursive:true});
// Electron's safeStorage wrapping key belongs to Chromium Local State. Reuse a
// private copy for decryption without opening or mutating the running profile.
const localState=path.join(app.getPath('appData'),'BotGoHermesPreview/chromium/Local State');
if(fs.existsSync(localState))fs.copyFileSync(localState,path.join(probeProfile,'Local State'));
app.setPath('userData',probeProfile);
app.whenReady().then(async()=>{
  let gateway;
  try {
    const profile=path.join(app.getPath('appData'),'BotGoHermesPreview');
    const credentials=JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(profile,'device.enc'))));
    const {createGateway}=require(path.join(root,'artifacts/hermes/apps/desktop/electron/botgo/gateway.cjs'));
    gateway=await createGateway({origin:'https://botgo.win',deviceToken:credentials.deviceToken,token:credentials.desktopKey});
    const report={time:new Date().toISOString(),models:gateway.catalog.map(m=>({id:m.id,protocol:m.protocol,modalities:m.modalities,limit:m.limit})),imageModels:gateway.imageModels};
    const update=await fetch('https://botgo.win/api/desktop/releases/current',{headers:{authorization:'Bearer '+credentials.deviceToken,'x-botgo-client-engine':'hermes'},signal:AbortSignal.timeout(20000)});
    const updateBody=await update.json();report.update={status:update.status,engine:updateBody.engine,version:updateBody.release?.version,available:!!updateBody.release};
    const active=JSON.parse(fs.readFileSync(path.join(profile,'active-account.json'))).id;
    const YAML=require('node:module').createRequire(path.join(root,'artifacts/hermes/apps/desktop/electron/botgo/config.cjs'))('yaml');
    const home=path.join(profile,'accounts',active);
    const cfg=YAML.parse(fs.readFileSync(path.join(home,'config.yaml'),'utf8'));
    report.currentConfig={memory:cfg.memory,compression:cfg.compression,backgroundReview:cfg.auxiliary?.background_review,
      personality:!!cfg.display?.personality,soulFile:fs.existsSync(path.join(home,'SOUL.md')),
      cronProvider:cfg.cron?.provider,enabledPlatforms:Object.entries(cfg.platforms||{}).filter(([,v])=>v.enabled).map(([k])=>k)};
    // No chats, prompts, identity documents or secrets are recorded.
    fs.writeFileSync(path.join(out,'catalog.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    if(process.argv.includes('--paid')) {
      const {writeManagedConfig}=require(path.join(root,'artifacts/hermes/apps/desktop/electron/botgo/config.cjs'));
      const syntheticHome=path.join(out,'native-home');writeManagedConfig(syntheticHome,gateway);
      const {spawn}=require('node:child_process');
      report.image=process.argv.includes('--resume') ? (()=>{
        const images=path.join(syntheticHome,'cache/generated/images');const file=fs.readdirSync(images).filter(x=>x.startsWith('botgo_')).sort().at(-1);
        return {success:true,image:path.join(images,file),bytes:fs.statSync(path.join(images,file)).size,reused:true};
      })() : await new Promise((resolve,reject)=>{
        const child=spawn(path.join(root,'artifacts/hermes-python/Scripts/python.exe'),[path.join(__dirname,'live-image.py')],{
          cwd:path.join(root,'artifacts/hermes'),windowsHide:true,env:{...process.env,PYTHONPATH:path.join(root,'artifacts/hermes'),
            HERMES_HOME:syntheticHome,BOTGO_HERMES_API_KEY:credentials.desktopKey,HERMES_SESSION_ID:'capabilities-image-20261023'}});
        let result='';child.stdout.on('data',v=>result+=v);child.stderr.on('data',()=>{});
        const timer=setTimeout(()=>{child.kill();reject(Error('Image native timeout'));},330000);
        child.on('exit',code=>{clearTimeout(timer);if(code!==0)reject(Error('Native image test failed: '+result.slice(-1000)));else resolve(JSON.parse(result.trim().split('\n').at(-1)));});
      });
      report.imageUsage=await gateway.usage('capabilities-image-20261023');
      fs.writeFileSync(path.join(out,'image-result.json'),JSON.stringify({image:report.image,usage:report.imageUsage},null,2));
      const model=gateway.catalog.find(m=>m.id==='gpt-6.1-sol')||gateway.catalog[0];
      const send=async(body,session)=>{
        const response=await fetch(gateway.baseURL+'/responses',{method:'POST',headers:{authorization:'Bearer '+credentials.desktopKey,
          'content-type':'application/json','x-session-id':session},body:JSON.stringify({model:model.id,stream:false,max_output_tokens:256,...body}),signal:AbortSignal.timeout(90000)});
        const text=await response.text();let value;
        if(text.trim().startsWith('{'))value=JSON.parse(text);
        else {const events=text.split(/\r?\n/).filter(x=>x.startsWith('data: ')).map(x=>x.slice(6)).filter(x=>x!=='[DONE]').map(x=>JSON.parse(x));
          value=events.findLast(x=>x.type==='response.completed')?.response || events.findLast(x=>x.type==='error') || {error:{code:'NO_COMPLETED_RESPONSE'}};}
        return {status:response.status,value};
      };
      const imageData=fs.readFileSync(report.image.image).toString('base64');
      const vision=await send({input:[{role:'user',content:[{type:'input_text',text:'What color and shape is pictured? Answer in five words.'},{type:'input_image',image_url:'data:image/png;base64,'+imageData}]}]},'capabilities-vision-20261023');
      report.vision={status:vision.status,text:vision.value.output?.flatMap(i=>i.content||[]).filter(i=>i.type==='output_text').map(i=>i.text).join(''),error:vision.value.error?.code};
      // An explicit unsupported audio payload tests rejection through the real
      // managed model route. Do not silently replace it with text or another key.
      const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
      const audio=await send({input:[{role:'user',content:[{type:'input_text',text:'Transcribe this synthetic silent audio.'},{type:'input_audio',input_audio:{data:wav.toString('base64'),format:'wav'}}]}]},'capabilities-audio-20261023');
      report.audioInput={status:audio.status,error:audio.value.error||audio.value.code||audio.value.message};
      report.audioOutput={advertised:gateway.catalog.some(m=>m.modalities?.output?.includes('audio')),nativeSpeechRoute:(await fetch(gateway.baseURL+'/audio/speech',{method:'POST',headers:{authorization:'Bearer '+credentials.desktopKey,'content-type':'application/json'},body:JSON.stringify({model:model.id,input:'BotGo audio test',voice:'alloy'})})).status};
      fs.writeFileSync(path.join(out,'paid-results.json'),JSON.stringify(report,null,2));
      console.log(JSON.stringify({image:report.image,imageUsage:report.imageUsage,vision:report.vision,audioInput:report.audioInput,audioOutput:report.audioOutput},null,2));
    }
  } catch(error) {console.error('Capability probe failed:',error.code||error.name, String(error.message).replace(/bg(?:k|dt)_[A-Za-z0-9_-]+/g,'[REDACTED]'));process.exitCode=1;}
  finally{await gateway?.close();app.exit(process.exitCode||0);}
});
