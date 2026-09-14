// Interactive candidate entry. Separate from the one-shot, credential-free smoke test.
const {app}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const desktop=path.join(root,'artifacts/opencode/packages/desktop');
const profile=path.join(root,'artifacts/verification/opencode-preview/profile');
fs.mkdirSync(profile,{recursive:true});
app.setAppPath(desktop);
app.setVersion(JSON.parse(fs.readFileSync(path.join(desktop,'package.json'),'utf8')).version);
app.setPath('userData',profile);
app.setPath('sessionData',path.join(profile,'chromium'));
process.env.BOTGO_PROFILE_ROOT=profile;
process.env.OPENCODE_DISABLE_MODELS_FETCH='true';
process.env.OPENCODE_DISABLE_AUTOUPDATE='true';
process.env.OPENCODE_SIDECAR_V2='0';
import(pathToFileURL(path.join(desktop,'out/main/index.js')).href).catch(error=>{
  console.error(String(error?.stack||error).replace(/(?:sk-|bgdt_|bgk_)[A-Za-z0-9_-]+/g,'[redacted]'));
  app.exit(1);
});
