import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(here);
const pin=JSON.parse(fs.readFileSync(path.join(here,'upstream.json'),'utf8'));
const source=path.join(root,pin.source), app=path.join(source,'apps/desktop'), out=path.join(app,'dist');
const python=path.join(root,'artifacts/hermes-python/Scripts/python.exe');
const run=(script,args=[])=>execFileSync(process.execPath,[path.join(source,script),...args],{cwd:app,stdio:'inherit',windowsHide:true});
run('apps/desktop/scripts/assert-root-install.mjs');
const nativeDeps=path.join(app,'build/native-deps');
const {nativeInputsComplete}=await import(pathToFileURL(path.join(app,'scripts/prepared-native-deps.mjs')));
if(!nativeInputsComplete({source,nativeDeps}))run('apps/desktop/scripts/stage-native-deps.mjs',['--source',source,'--out',nativeDeps]);
const stamp=path.join(app,'build/install-stamp.json');
fs.mkdirSync(path.dirname(stamp),{recursive:true});
fs.writeFileSync(stamp,JSON.stringify({schemaVersion:1,commit:pin.commit,commitDate:null,branch:null,builtAt:new Date().toISOString(),dirty:true,source:'commit-build',distribution:'desktop-app',updateMechanism:'external',baseVersion:pin.version,version:pin.version,payload:'bootstrap'}));
// Existing BotGo artwork; all upstream attribution stays in LICENSE material.
const icon=path.join(root,'artifacts/opencode-1.18.35/packages/desktop/resources/icons/icon.ico');
fs.copyFileSync(icon,path.join(app,'public/botgo.ico'));
execFileSync(python,['-c',"from PIL import Image; import sys; im=Image.open(sys.argv[1]); im.save(sys.argv[2]); im.save(sys.argv[3])",icon,path.join(app,'public/botgo-mark.png'),path.join(app,'public/apple-touch-icon.png')],{stdio:'inherit',windowsHide:true});
const {buildDesktop}=await import(pathToFileURL(path.join(source,'scripts/build/desktop.mjs')));
process.chdir(app);
process.env.NODE_ENV='production';
const {buildInputs}=await import(pathToFileURL(path.join(source,'scripts/build/freshness.mjs')));
const before=buildInputs(source,'desktop',{icons:path.join(app,'public'),stamp,nativeDeps});
try { await buildDesktop({source,out,icons:source,stamp,nativeDeps,typecheck:true}); }
catch(error){const after=buildInputs(source,'desktop',{icons:path.join(app,'public'),stamp,nativeDeps});console.error('Input identity diagnostic: '+JSON.stringify({sourceChanged:before.sourceHash!==after.sourceHash,preparedChanged:before.prepared.map((v,i)=>({name:v.name,changed:v.hash!==after.prepared[i].hash})),environmentChanged:JSON.stringify(before.env)!==JSON.stringify(after.env)}));throw error;}
for(const file of ['botgo-account.html','botgo-account.css','botgo-account-ui.js','botgo-preload.cjs','botgo-mark.svg','weixin-login.py','qq-login.py'])fs.copyFileSync(path.join(here,'overlay',file),path.join(out,file));
fs.copyFileSync(path.join(root,'opencode-desktop/runtime/verify-signature.ps1'),path.join(out,'verify-signature.ps1'));
for(const file of ['botgo.ico','botgo-mark.png'])fs.copyFileSync(path.join(app,'public',file),path.join(out,file));
fs.copyFileSync(path.join(source,'LICENSE'),path.join(out,'LICENSE-Hermes.txt'));
console.log('Built native BotGo Hermes desktop: '+out);
