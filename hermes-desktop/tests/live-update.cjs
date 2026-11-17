// Real authenticated metadata/download verification. Does not run the installer.
const {app,safeStorage}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'artifacts/verification/hermes-capabilities-20261023');
const profile=path.join(app.getPath('appData'),'BotGoHermesPreview'),isolated=path.join(out,'update-electron');
fs.mkdirSync(isolated,{recursive:true});fs.copyFileSync(path.join(profile,'chromium/Local State'),path.join(isolated,'Local State'));app.setPath('userData',isolated);
app.whenReady().then(async()=>{
  let updater;
  try{
    const credential=JSON.parse(safeStorage.decryptString(fs.readFileSync(path.join(profile,'device.enc'))));
    const {createUpdater}=require('../../opencode-desktop/runtime/updater.cjs');
    const {updateFetch}=require('../runtime/update-channel.cjs');
    const requestLog=[];
    const checkedFetch=async(input,options)=>{const response=await fetch(input,options);const entry={path:new URL(String(input)).pathname,status:response.status,contentType:response.headers.get('content-type')};if(!response.ok){entry.error=(await response.clone().text()).slice(0,1500);}requestLog.push(entry);fs.writeFileSync(path.join(out,'online-update-requests.json'),JSON.stringify(requestLog,null,2));return response;};
    updater=createUpdater({currentVersion:'2.0.0-preview.4',origin:'https://botgo.win',directory:path.join(out,'verified-update'),
      deviceToken:()=>credential.deviceToken,fetchImpl:updateFetch(checkedFetch),
      verifySignature:async file=>{await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-File',path.join(root,'opencode-desktop/runtime/verify-signature.ps1'),'-FilePath',file],{windowsHide:true,timeout:30000});},
      launch:async()=>{throw Error('This probe never installs automatically');}});
    const result=await updater.check();
    if(result.status!=='ready'||result.version!=='2.0.0-preview.5')throw Error('Online updater not ready: '+result.status+' '+(result.message||''));
    const legacy=await(await fetch('https://botgo.win/api/desktop/releases/current',{headers:{authorization:'Bearer '+credential.deviceToken},signal:AbortSignal.timeout(20000)})).json();
    if(legacy.release?.version!=='1.3.9')throw Error('Legacy channel changed unexpectedly');
    fs.writeFileSync(path.join(out,'online-update-result.json'),JSON.stringify({passed:true,...result,legacyVersion:legacy.release.version,fullDownload:true,signatureVerified:true,time:new Date().toISOString()},null,2));
    console.log('Real Hermes update download/hash/pinned signature passed; legacy 1.3.9 preserved');
  }catch(error){console.error(error.message);process.exitCode=1;}
  finally{updater?.cancel();app.exit(process.exitCode||0);}
});
