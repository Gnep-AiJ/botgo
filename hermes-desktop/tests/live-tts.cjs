const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'artifacts/verification/hermes-capabilities-20261023');
const profile=path.join(app.getPath('appData'),'BotGoHermesPreview');
const probe=path.join(out,'tts-electron');fs.mkdirSync(probe,{recursive:true});
fs.copyFileSync(path.join(profile,'chromium/Local State'),path.join(probe,'Local State'));
app.setPath('userData',probe);
app.whenReady().then(async()=>{
 let gateway;
 try{
  const credentials=JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(profile,'device.enc'))));
  const source=path.join(root,'artifacts/hermes');
  gateway=await require(path.join(source,'apps/desktop/electron/botgo/gateway.cjs')).createGateway({origin:'https://botgo.win',deviceToken:credentials.deviceToken,token:credentials.desktopKey});
  const home=path.join(out,'model-tts');
  require(path.join(source,'apps/desktop/electron/botgo/config.cjs')).writeManagedConfig(home,gateway);
  await new Promise((resolve,reject)=>{
   const child=spawn(path.join(root,'artifacts/hermes-python/Scripts/python.exe'),[path.join(__dirname,'live-tts.py')],{cwd:source,windowsHide:true,
    env:{...process.env,PYTHONPATH:source,HERMES_HOME:home,HERMES_RUNTIME_DIR:path.join(root,'artifacts/hermes-tools'),BOTGO_HERMES_API_KEY:credentials.desktopKey}});
   // Keep model/plugin diagnostics private in memory; only the synthetic result is written.
   child.stdout.resume();child.stderr.resume();
   const timer=setTimeout(()=>{child.kill();reject(Error('Native model TTS timeout'));},180000);
   child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('Native model TTS failed, exit '+code));});
  });
  console.log(fs.readFileSync(path.join(home,'result.json'),'utf8'));
 }catch(error){console.error('TTS verification:',error.name);process.exitCode=1;}
 finally{await gateway?.close();app.exit(process.exitCode||0);}
});
