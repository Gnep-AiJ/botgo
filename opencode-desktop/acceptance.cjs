// Native app + authenticated sidecar + production gateway; no secrets in output.
const {app,net}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
if(!process.argv.includes('--live'))throw Error('Explicit --live required');
const output=path.join(root,'artifacts/verification/client-acceptance',String(Date.now()));
const project=path.join(output,'中文项目');
fs.mkdirSync(project,{recursive:true});
let finished=false,started=false;
const result={ok:false,ui:false,nativeTask:false};
const finish=(error)=>{
  if(finished)return;finished=true;
  if(error)result.error=/^[A-Z_0-9]+$/.test(error.message)?error.message:'ACCEPTANCE_FAILED';
  result.ok=result.ui&&result.nativeTask&&!error;
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({...result,output}));app.quit();
};
setTimeout(()=>finish(Error('ACCEPTANCE_TIMEOUT')),240000).unref();
app.on('browser-window-created',(_event,win)=>{
  win.webContents.on('did-finish-load',async()=>{
    if(started)return;started=true;
    try{
      for(let n=0;n<75;n++){
        const status=await win.webContents.executeJavaScript('window.api.botgo.state().then(s=>({status:s.status,error:s.error}))');
        if(status.status==='error')throw Error('LOGIN_'+String(status.error).toUpperCase());
        if(status.status==='ready')break;
        await new Promise(resolve=>setTimeout(resolve,1000));
      }
      const server=await win.webContents.executeJavaScript('window.api.awaitInitialization()');
      if(!server?.url||!server.password)throw Error('SIDECAR_UNAVAILABLE');
      await new Promise(resolve=>setTimeout(resolve,3000));
      result.ui=await win.webContents.executeJavaScript('Boolean(document.querySelector(".botgo-account-trigger"))');
      fs.writeFileSync(path.join(output,'workspace.png'),(await win.webContents.capturePage()).toPNG());
      if(!result.ui)throw Error('ACCOUNT_ENTRY_MISSING');
      const request=async(route,body)=>{
        const url=new URL(route,server.url);url.searchParams.set('directory',project);
        const response=await net.fetch(url.href,{method:body?'POST':'GET',signal:AbortSignal.timeout(120000),
          headers:{authorization:'Basic '+Buffer.from((server.username||'opencode')+':'+server.password).toString('base64'),'content-type':'application/json'},
          ...(body?{body:JSON.stringify(body)}:{})});
        if(!response.ok){await response.body?.cancel();throw Error('NATIVE_HTTP_'+response.status);}
        return response.json();
      };
      const paths=await request('/path');
      if(typeof paths.worktree!=='string')throw Error('WORKTREE_UNAVAILABLE');
      const relative=path.relative(paths.worktree,path.join(project,'gate.txt'));
      const rules=[{permission:'edit',pattern:relative.replaceAll('\\','/'),action:'allow'},{permission:'read',pattern:relative,action:'allow'}];
      const session=await request('/session',{title:'BotGo 发布验证',permission:[{permission:'*',pattern:'*',action:'deny'},...rules]});
      result.sessionId=session.id;
      const answer=await request('/session/'+session.id+'/message',{model:{providerID:'botgo-responses',modelID:'gpt-5.6-terra'},parts:[{type:'text',text:'Use your edit tool to create gate.txt containing exactly BOTGO_NATIVE_OK. Read that file back. Do not run commands, access other files, or use subagents. Then reply OK.'}]});
      if(answer.info?.error)throw Error('NATIVE_TASK_ERROR');
      result.nativeTask=fs.existsSync(path.join(project,'gate.txt'))&&fs.readFileSync(path.join(project,'gate.txt'),'utf8').trim()==='BOTGO_NATIVE_OK';
      const usage=await win.webContents.executeJavaScript(`window.api.botgo.usage(${JSON.stringify(session.id)})`);
      result.requestCount=usage.requests?.length;result.chargedMicros=usage.chargedMicros;
      if(!usage.requests?.length||usage.requests.some(row=>row.state!=='completed'))throw Error('NATIVE_LEDGER_UNSETTLED');
      finish();
    }catch(error){finish(error);}
  });
});
require('./preview.cjs');
