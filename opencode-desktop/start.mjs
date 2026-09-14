import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const executable=path.join(root,'artifacts/opencode/node_modules/electron/dist/electron.exe');
const entry=path.join(root,'opencode-desktop/preview.cjs');
for(const file of [executable,entry,path.join(root,'artifacts/opencode/packages/desktop/out/main/index.js')]){
  if(!fs.existsSync(file))throw Error(`Missing build input: ${file}; run npm run opencode:build first`);
}
if(process.argv.includes('--check')){
  console.log('Interactive entry inputs exist; this does not verify the GUI or backend.');
}else{
  const env={...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(executable,[entry],{cwd:root,env,stdio:'inherit'});
  child.on('error',error=>{console.error(error.message);process.exitCode=1;});
  child.on('close',code=>{process.exitCode=code??1;});
}
