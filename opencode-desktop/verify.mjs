// User-run native diagnostic. A Chromium fatal exit code of zero is NOT success.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const evidence=path.join(root,'artifacts/verification/opencode-native',String(Date.now()));
fs.mkdirSync(evidence,{recursive:true});
const executable=path.join(root,'artifacts/opencode/node_modules/electron/dist/electron.exe');
const log=fs.createWriteStream(path.join(evidence,'process.log'));
const child=spawn(executable,[path.join(root,'opencode-desktop/smoke.cjs')],{cwd:root,
  env:{...process.env,BOTGO_SMOKE_OUTPUT:evidence},stdio:['ignore','pipe','pipe']});
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
child.on('error',error=>{console.error(error.message);process.exitCode=1;log.end();});
child.on('close',(exitCode,signal)=>{
  log.end();
  const resultPath=path.join(evidence,'result.json');
  if(!fs.existsSync(resultPath))fs.writeFileSync(resultPath,JSON.stringify({ok:false,exitCode,signal,error:'Native process exited without completing the UI check'},null,2));
  const result=JSON.parse(fs.readFileSync(resultPath,'utf8'));
  console.log(JSON.stringify({...result,evidence},null,2));
  process.exitCode=result.ok?0:1;
});
