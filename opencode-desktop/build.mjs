import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source=path.join(root,'artifacts/opencode');
const bun=path.join(root,'artifacts/verification/opencode-bootstrap/build-tools/node_modules/@oven/bun-windows-x64/bin/bun.exe');
const output=path.join(root,'artifacts/verification/opencode-build',String(Date.now()));
fs.mkdirSync(output,{recursive:true});
const env={...process.env,OPENCODE_CHANNEL:'dev',OPENCODE_VERSION:'1.18.30',MODELS_DEV_API_JSON:path.join(root,'opencode-desktop/models-empty.json')};
async function run(name,command,args,cwd){
  const log=fs.createWriteStream(path.join(output,`${name}.log`));
  const child=spawn(command,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const result=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  await new Promise(resolve=>log.end(resolve));
  if(result.code!==0)throw Error(`${name} failed (${JSON.stringify(result)}); see ${path.join(output,`${name}.log`)}`);
  console.log(`${name}: passed`);
}
try{
  if(!fs.existsSync(bun))throw Error('Pinned local Bun 1.3.14 is missing');
  await run('prepare',process.execPath,['opencode-desktop/prepare.mjs'],root);
  await run('desktop-typecheck',bun,['run','typecheck'],path.join(source,'packages/desktop'));
  await run('native-server',bun,['script/build-node.ts'],path.join(source,'packages/opencode'));
  await run('desktop-build',process.execPath,['../../node_modules/electron-vite/bin/electron-vite.js','build','--logLevel','warn'],path.join(source,'packages/desktop'));
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({ok:true,source,visualVerified:false,productionVerified:false},null,2));
  console.log(`Build evidence: ${output}`);
}catch(error){console.error(error.message);process.exitCode=1;}
