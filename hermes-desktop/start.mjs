import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source=path.join(root,'artifacts/hermes');
const app=path.join(source,'apps/desktop');
const profile=process.env.BOTGO_PROFILE_ROOT||path.join(root,'artifacts/verification/hermes-manual/profile');
const env={...process.env,
 BOTGO_PROFILE_ROOT:profile,HERMES_HOME:path.join(profile,'pending'),
 HERMES_RUNTIME_DIR:path.join(root,'artifacts/hermes-tools'),
 HERMES_DESKTOP_USER_DATA_DIR:path.join(profile,'chromium'),
 HERMES_DESKTOP_PYTHON:path.join(root,'artifacts/hermes-python/Scripts/python.exe'),
 HERMES_DESKTOP_HERMES_ROOT:source,HERMES_DESKTOP_CWD:path.join(profile,'workspace'),
 HERMES_DESKTOP_CDP_PORT:'off',HERMES_DESKTOP_APP_NAME:'BotGo',
};
fs.mkdirSync(env.HERMES_DESKTOP_CWD,{recursive:true});
delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(path.join(app,'node_modules/electron/dist/electron.exe'),[app],{cwd:root,env,stdio:'inherit',windowsHide:false});
child.once('error',error=>{console.error(error.message);process.exitCode=1});
child.once('exit',code=>{process.exitCode=code??1});
