import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(here);
const pin=JSON.parse(fs.readFileSync(path.join(here,'upstream.json'),'utf8'));
const source=path.join(root,pin.source),desktop=path.join(source,'apps/desktop');
const require=createRequire(path.join(desktop,'package.json'));
const installerOnly=process.argv.includes('--installer-only');
if(!installerOnly)execFileSync(path.join(root,'artifacts/hermes-python/Scripts/python.exe'),[path.join(here,'prepare-pm.py')],{cwd:root,windowsHide:true,stdio:'inherit'});
const {build,Platform,Arch}=require('electron-builder');
const project=path.join(root,'artifacts/hermes-package');fs.mkdirSync(project,{recursive:true});
const release=path.join(root,'artifacts/releases/hermes-preview-polish');
const dependencies={};
for(const name of ['node-pty','get-windows']){
 const input=path.join(desktop,'dist/node_modules',name),target=path.join(project,'node_modules',name);
 fs.cpSync(input,target,{recursive:true});
 const metadata=JSON.parse(fs.readFileSync(path.join(target,'package.json'),'utf8'));
 dependencies[name]=metadata.version;
 // These prepared JS/native payloads have no runtime package dependencies.
 // Their published manifests list compilers/headers/install scripts instead.
 for(const key of ['dependencies','optionalDependencies','peerDependencies','devDependencies','scripts'])delete metadata[key];
 fs.writeFileSync(path.join(target,'package.json'),JSON.stringify(metadata));
}
fs.writeFileSync(path.join(project,'package.json'),JSON.stringify({name:'botgo-hermes-preview',productName:'BotGo',version:pin.version,private:true,main:'launcher.cjs',description:'BotGo personal Agent desktop',author:'BotGo',dependencies}));
fs.copyFileSync(path.join(here,'launcher.cjs'),path.join(project,'launcher.cjs'));
const facts=JSON.parse(fs.readFileSync(path.join(root,'artifacts/hermes-tools/facts.json'),'utf8'));
// Native facts are indexed by package name. Resolve the actual staged interpreter.
const entries=fs.readdirSync(path.join(root,'artifacts/hermes-tools')).filter(n=>n.startsWith('python-')&&!n.startsWith('fetch-'));
if(entries.length!==1)throw Error('Expected exactly one pinned Python runtime');
const python='tools/'+entries[0]+'/python.exe';
if(!fs.existsSync(path.join(root,'artifacts/hermes-tools',entries[0],'python.exe')))throw Error('Pinned runtime layout changed');
fs.writeFileSync(path.join(project,'runtime.json'),JSON.stringify({python,commit:pin.commit,version:pin.version}));
const extraResources=[
 {from:path.join(root,'opencode-desktop/runtime/verify-signature.ps1'),to:'botgo/verify-signature.ps1'},
 {from:path.join(here,'overlay/weixin-login.py'),to:'botgo/weixin-login.py'},
 {from:path.join(here,'overlay/qq-login.py'),to:'botgo/qq-login.py'},
 {from:source,to:'hermes-payload/hermes-agent',filter:['**/*','!node_modules/**/*','!**/node_modules/**/*','!apps/desktop/**/*','!tests/**/*','!tests-js/**/*','!website/**/*','!.git/**/*','!**/__pycache__/**/*','!**/*.pyc','!botgo-overlay.json']},
 {from:path.join(root,'artifacts/hermes-python/Lib/site-packages'),to:'hermes-payload/venv/Lib/site-packages',filter:['**/*','!__editable__*','!**/__pycache__/**/*','!**/*.pyc']},
 {from:path.join(root,'artifacts/hermes-pm-runtime'),to:'hermes-payload/pm-runtime',filter:['**/*','!**/__pycache__/**/*','!**/*.pyc']},
 {from:path.join(root,'artifacts/hermes-tools'),to:'hermes-payload/tools',filter:['**/*','!fetch-*/**/*','!.staging-*/**/*','!.install.lock']},
 {from:path.join(here,'sitecustomize.py'),to:'hermes-payload/hermes-agent/sitecustomize.py'},
 {from:path.join(project,'runtime.json'),to:'hermes-payload/runtime.json'},
];
const thumbprint=process.env.BOTGO_PREVIEW_CERT_SHA1;
if(!/^[A-Fa-f0-9]{40}$/.test(thumbprint||''))throw Error('Pinned BotGo signing identity is required');
if(installerOnly&&!process.argv.includes('--installer'))throw Error('Installer-only requires --installer');
await build({projectDir:project,prepackaged:installerOnly?path.join(release,'win-unpacked'):undefined,targets:Platform.WINDOWS.createTarget(process.argv.includes('--installer')?'nsis':'dir',Arch.x64),config:{
 appId:'com.botgo.hermes.preview',productName:'BotGo',artifactName:'BotGo-${version}-win-x64.${ext}',
 // The modern 3.12 bundle's nsisunz fails on this same valid archive. Pin the
 // officially supported legacy toolset used by the existing BotGo release flow.
 toolsets:{nsis:'0.0.0'},
 directories:{output:release},
 afterPack: async context=>{
  const payload=path.join(context.appOutDir,'resources/hermes-payload');
  execFileSync(path.join(payload,python),[path.join(here,'seal-payload.py'),payload],{cwd:path.join(payload,'hermes-agent'),windowsHide:true,stdio:'inherit',env:{...process.env,PYTHONPATH:[path.join(payload,'hermes-agent'),path.join(payload,'venv/Lib/site-packages')].join(path.delimiter),PYTHONNOUSERSITE:'1'}});
 },
 electronDist:path.join(desktop,'node_modules/electron/dist'),electronVersion:'40.10.2',nativeModules:{npmRebuild:false},asar:true,
 files:[{from:path.join(desktop,'dist'),to:'dist'},'launcher.cjs','package.json'],extraResources,
 extraFiles:[{from:path.join(source,'LICENSE'),to:'LICENSE-Hermes.txt'}],
 win:{icon:path.join(desktop,'public/botgo.ico'),sign:{type:'signtool',certificateSha1:thumbprint,signingHashAlgorithms:['sha256'],sign:path.join(here,'sign.cjs')}},
 forceCodeSigning:true,
 // ZIP extracts directly to the destination. The default 7z flow first expands
 // to a temporary tree, then invokes NSIS CopyFiles over 30k+ runtime files;
 // both isolated installation attempts exceeded their bounded acceptance time.
 nsis:{useZip:true,differentialPackage:false,oneClick:false,perMachine:false,allowToChangeInstallationDirectory:true,deleteAppDataOnUninstall:false,shortcutName:'BotGo'},publish:null,
}});
const signed=process.argv.includes('--installer')?fs.readdirSync(release).filter(name=>name.endsWith('.exe')).map(name=>path.join(release,name)):[path.join(release,'win-unpacked/BotGo.exe')];
if(!signed.length)throw Error('Expected signed release output');
for(const file of signed)execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'opencode-desktop/runtime/verify-signature.ps1'),'-FilePath',file],{windowsHide:true,stdio:'inherit'});
console.log('BotGo Hermes candidate packaged; pinned signatures verified');
