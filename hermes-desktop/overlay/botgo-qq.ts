import { app, ipcMain, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, type ChildProcess } from 'node:child_process'
import QRCode from 'qrcode'
import configModule from './botgo/config.cjs'
interface Credential { app_id:string;client_secret:string;user_openid:string }
interface State {status:string;qr?:string;message?:string}
let state:State={status:'disconnected'},worker:ChildProcess|undefined
const file=()=>path.join(process.env.HERMES_HOME!,'botgo-qq.enc')
function inject(c:Credential){process.env.QQ_APP_ID=c.app_id;process.env.QQ_CLIENT_SECRET=c.client_secret;process.env.QQ_ALLOWED_USERS=c.user_openid;process.env.QQ_ALLOW_ALL_USERS='false';process.env.QQBOT_HOME_CHANNEL=c.user_openid}
export function restoreBotGoQq(){if(fs.existsSync(file())){inject(JSON.parse(safeStorage.decryptString(fs.readFileSync(file()))));state={status:'saved',message:'已绑定'}}}
export function initializeBotGoQq(trusted:(e:Electron.IpcMainInvokeEvent)=>void,busy:()=>boolean,restart:()=>Promise<void>){
  ipcMain.handle('botgo:qq:state',e=>{trusted(e);return state})
  ipcMain.handle('botgo:qq:cancel',e=>{trusted(e);worker?.kill();worker=undefined;state={status:'cancelled'};return state})
  ipcMain.handle('botgo:qq:disconnect',async e=>{trusted(e);if(busy())return {status:'busy',message:'请等待任务结束'};worker?.kill();worker=undefined;if(fs.existsSync(file()))fs.unlinkSync(file());for(const key of ['QQ_APP_ID','QQ_CLIENT_SECRET','QQ_ALLOWED_USERS','QQ_ALLOW_ALL_USERS','QQBOT_HOME_CHANNEL'])delete process.env[key];configModule.setPlatformEnabled(process.env.HERMES_HOME!,'qqbot',false);await restart();state={status:'disconnected'};return state})
  ipcMain.handle('botgo:qq:start',e=>{trusted(e);if(worker)return state;if(busy())return {status:'busy',message:'请等待任务结束'};
    const script=app.isPackaged?path.join(process.resourcesPath,'botgo/qq-login.py'):path.join(path.dirname(fileURLToPath(import.meta.url)),'qq-login.py')
    const child=spawn(process.env.HERMES_DESKTOP_PYTHON!,[script],{cwd:process.env.HERMES_DESKTOP_HERMES_ROOT,env:process.env,windowsHide:true,stdio:['ignore','pipe','ignore']});worker=child;state={status:'starting',message:'正在获取二维码…'};let buffer='',done=false
    child.stdout!.setEncoding('utf8');child.stdout!.on('data',async chunk=>{buffer+=chunk;if(buffer.length>65536){child.kill();state={status:'error',message:'响应异常，请重试'};return}let i:number;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);try{const value=JSON.parse(line);if(worker!==child)continue;
      if(value.event==='qr'){const url=new URL(value.url);if(url.protocol!=='https:'||url.hostname!=='q.qq.com')throw Error('Invalid QR');const qr=await QRCode.toDataURL(value.url,{width:240,margin:2});if(worker===child)state={status:'qr',qr,message:'使用 QQ 扫码并确认'}}
      else if(value.event==='credentials'){const c=value.credentials as Credential;if(!c.app_id||!c.client_secret||!c.user_openid||!safeStorage.isEncryptionAvailable())throw Error('Invalid credentials');fs.writeFileSync(file(),safeStorage.encryptString(JSON.stringify(c)));inject(c);configModule.setPlatformEnabled(process.env.HERMES_HOME!,'qqbot',true);done=true;state={status:'saved',message:'已绑定，正在连接…'};if(busy()){state.message='请在任务结束后重启渠道';continue}await restart();state={status:'saved',message:'已绑定，请发送消息验证'}}
      else if(value.event==='error')state={status:'error',message:'扫码未完成，请重试'}
    }catch{state={status:'error',message:'连接失败，请重试'}}}})
    child.once('error',()=>{if(worker===child){worker=undefined;state={status:'error',message:'组件启动失败'}}});child.once('exit',()=>{if(worker===child){worker=undefined;if(!done&&state.status!=='error')state={status:'error',message:'二维码已失效，请重试'}}});return state
  });app.once('before-quit',()=>worker?.kill())
}
