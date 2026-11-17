// Install the frozen upstream workspaces before applying branded package metadata.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import paths from './paths.cjs';
const {root,source,original,upstream}=paths;
const manifestPath=path.join(source,'botgo-overlay.json');
const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):{};
const report=JSON.parse(fs.readFileSync(path.join(source,'extraction-report.json'),'utf8'));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
for(const file of Object.keys(manifest).filter(file=>file.endsWith('/package.json'))){
  const target=path.join(source,file),pristine=fs.readFileSync(path.join(original,file));
  if(hash(pristine)!==report.fileSha256[file]||hash(fs.readFileSync(target))!==manifest[file])throw Error(`Changed workspace metadata: ${file}`);
  fs.writeFileSync(target,pristine);manifest[file]=hash(pristine);
}
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const bun=path.join(root,'artifacts/verification/opencode-bootstrap/build-tools/node_modules/@oven/bun-windows-x64/bin/bun.exe');
const evidence=path.join(root,'artifacts/verification',`opencode-${upstream.version}-upgrade`);
const cache=path.join(root,'artifacts/cache',`bun-${upstream.version}-${Date.now()}`);
fs.mkdirSync(cache,{recursive:true});
const log=fs.createWriteStream(path.join(evidence,'install-isolated.log'));
const child=spawn(bun,['install','--frozen-lockfile','--ignore-scripts','--linker','hoisted'],{cwd:source,windowsHide:true,env:{...process.env,BUN_INSTALL_CACHE_DIR:cache},stdio:['ignore','pipe','pipe']});
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
await new Promise(resolve=>log.end(resolve));
if(code!==0)throw Error(`Frozen dependency installation failed (${code}); see ${evidence}/install-isolated.log`);
console.log(`Frozen upstream dependencies installed; cache: ${cache}`);
