const {app}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const {pathToFileURL}=require('node:url');
const payload=path.join(process.resourcesPath,'hermes-payload');
const runtime=JSON.parse(fs.readFileSync(path.join(payload,'runtime.json'),'utf8'));
const profile=process.env.BOTGO_PROFILE_ROOT||path.join(app.getPath('appData'),'BotGoHermesPreview');
Object.assign(process.env,{
 BOTGO_PROFILE_ROOT:profile,HERMES_HOME:path.join(profile,'pending'),
 HERMES_RUNTIME_DIR:path.join(payload,'tools'),
 HERMES_DESKTOP_USER_DATA_DIR:path.join(profile,'chromium'),
 HERMES_DESKTOP_HERMES_ROOT:path.join(payload,'hermes-agent'),
 HERMES_DESKTOP_PYTHON:path.join(payload,runtime.python),
 HERMES_DESKTOP_CWD:path.join(profile,'workspace'),
 HERMES_DESKTOP_CDP_PORT:'off',HERMES_DESKTOP_APP_NAME:'BotGo',
 PYTHONPATH:[path.join(payload,'hermes-agent'),path.join(payload,'venv/Lib/site-packages')].join(path.delimiter),PYTHONNOUSERSITE:'1',
});
fs.mkdirSync(process.env.HERMES_DESKTOP_CWD,{recursive:true});
import(pathToFileURL(path.join(__dirname,'dist/electron-main.mjs'))).catch(error=>{
  fs.mkdirSync(profile,{recursive:true});
  fs.writeFileSync(path.join(profile,'bootstrap-error.log'),String(error?.stack||error));
  app.exit(1);
});
