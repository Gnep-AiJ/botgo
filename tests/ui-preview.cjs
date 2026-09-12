// Isolated Chromium/Electron visual verification. Account/task data are fixtures;
// this never authorizes a device, makes a payment, or runs a local agent task.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.tmp-ui-check');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();
app.on('window-all-closed',()=>{});
const errors=[],results=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function run(win,js){return win.webContents.executeJavaScript(js,true);}
async function shot(win,name){await pause(250);fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());}
function window(options={}){const win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{backgroundThrottling:false,contextIsolation:true,nodeIntegration:false,sandbox:true,...options}});win.showInactive();win.webContents.on('console-message',(_event,level,message)=>{if(level===3&&!/favicon|401|403|404|503/.test(message))errors.push(message);});return win;}
app.whenReady().then(async()=>{
 try{
  const web=window();
  for(const width of [1440,390,360])for(const theme of ['light','dark']){
    web.setContentSize(width,900);await web.loadURL('http://127.0.0.1:4173/workspace.html?preview=chat');
    await pause(250);await run(web,`localStorage.setItem('botgo-theme','${theme}');if(document.documentElement.dataset.theme!=='${theme}')document.querySelector('#theme-toggle').click();document.querySelector('#model-picker').click()`);
    const menu=await run(web,`(()=>{const m=document.querySelector('.botgo-menu:not([hidden])'),r=m.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,count:m.querySelectorAll('button').length,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}})()`);
    assert.equal(menu.count,6);assert.ok(menu.left>=0&&menu.right<=menu.width&&menu.top>=0&&menu.bottom<=menu.height,JSON.stringify(menu));assert.equal(menu.overflow,false);
    await shot(web,`web-menu-${width}-${theme}`);
    await run(web,`document.querySelector('.botgo-menu:not([hidden])').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
    assert.equal(await run(web,`document.activeElement.id`),'model-picker');
    await run(web,`document.querySelector('#chat-input').value='展示代码示例';document.querySelector('#chat-input').dispatchEvent(new Event('input'));document.querySelector('#chat-form').requestSubmit()`);
    await pause(200);assert.equal(await run(web,`document.querySelectorAll('.message-body pre code').length`),1);
    await shot(web,`web-chat-${width}-${theme}`);results.push({type:'web',width,theme,menu,markdown:true});
  }
  for(const view of ['agents','tutorials']){web.setContentSize(390,900);await web.loadURL(`http://127.0.0.1:4173/workspace.html?view=${view}`);await shot(web,'web-'+view);assert.equal(await run(web,'document.documentElement.scrollWidth>innerWidth'),false);}
  await web.loadURL('http://127.0.0.1:4173/workspace.html?preview=account');await shot(web,'web-account');assert.equal(await run(web,`document.querySelector('#subscription-dialog').open`),true);web.destroy();
  const models=['gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.5','gpt-5.4','gpt-6-astra'].map(id=>({id,name:id,enabled:id!=='gpt-6-astra',agent:true}));
  ipcMain.handle('models:get',()=>({defaultModel:models[0].id,models}));ipcMain.handle('account:get',()=>({account:{email:'preview@botgo.local',credits:20,balanceCents:2000}}));
  ipcMain.handle('history:get',()=>({selectedProject:root,selectedThreadId:'preview',recentProjects:[root],threads:[{id:'preview',projectPath:root,title:'界面预览',status:'completed',messages:[{role:'user',content:'展示安装方法'},{role:'assistant',model:models[0].id,content:'**打开 PowerShell**，输入：\n\n```powershell\nbotgo\n```'}]}]}));
  const desktop=window({preload:path.join(root,'desktop/preload.cjs')});
  for(const zoom of [1,1.25,1.5]){desktop.setContentSize(1000,800);await desktop.loadFile(path.join(root,'desktop/index.html'));desktop.webContents.setZoomFactor(zoom);await pause(150);await run(desktop,`document.querySelector('[data-model]').previousElementSibling.click()`);const bounds=await run(desktop,`(()=>{const r=document.querySelector('.botgo-menu:not([hidden])').getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};})()`);assert.ok(bounds.top>=0&&bounds.bottom<=bounds.height&&bounds.right<=bounds.width,JSON.stringify(bounds));await shot(desktop,'desktop-model-'+zoom);results.push({type:'desktop',zoom,bounds});}
  desktop.webContents.setZoomFactor(1);desktop.setContentSize(760,640);await run(desktop,`document.querySelector('.botgo-menu:not([hidden])').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));document.querySelector('[data-mode]').previousElementSibling.click()`);await shot(desktop,'desktop-permission-760');desktop.destroy();
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({verifiedAt:new Date().toISOString(),results,errors},null,2));assert.deepEqual(errors,[]);if(fs.existsSync(path.join(out,'failure.txt')))fs.unlinkSync(path.join(out,'failure.txt'));console.log(JSON.stringify({ok:true,screenshots:out,checks:results.length}));app.exit(0);
 }catch(e){console.error(e);fs.writeFileSync(path.join(out,'failure.txt'),String(e.stack));app.exit(1);}
});
