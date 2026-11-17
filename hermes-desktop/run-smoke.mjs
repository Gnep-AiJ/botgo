import fs from 'node:fs';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=process.argv.includes('--fixture');
const log=fs.openSync(path.join(root,'artifacts/verification/hermes-acceptance',process.argv.includes('--packaged-runtime')?'electron-packaged-runtime.log':fixture?'electron-native.log':'electron-login.log'),'w');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(path.join(root,'artifacts/hermes/apps/desktop/node_modules/electron/dist/electron.exe'),[path.join(root,'hermes-desktop/smoke.cjs'),...process.argv.slice(2)],{cwd:root,env,windowsHide:true,stdio:['ignore',log,log]});
child.once('error',error=>{console.error(error.message);process.exitCode=1});
child.once('exit',code=>{fs.closeSync(log);process.exitCode=code??1});
