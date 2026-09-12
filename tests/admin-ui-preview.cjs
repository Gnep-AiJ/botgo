// Local API fixtures only. Never uses production credentials.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.tmp-admin-ui');fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();
let authorized=true,meterFailure=false,empty=false,writes=0;
const price={input:4,cached:.4,write:5,output:20,longThreshold:272000,longInput:2,longOutput:1.5,source:'https://developers.openai.com/api/docs/pricing',date:'2026-09-12',tier:'default'};
const models=['gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.5','gpt-6-astra'].map(id=>({id,name:id.replace('gpt-','GPT-'),upstream_id:id,enabled:1,web_enabled:1,agent_enabled:1,multiplier_ppm:null,price}));
const fixture={
 '/admin/overview':{admin:{email:'admin@example.invalid'},overview:{accounts:128,active:112,pendingVerifications:3}},
 '/admin/accounts':{accounts:[{id:'fixture-user',email:'member@example.invalid',role:'user',status:'active',credit_balance:12.5,created_at:'2026-09-12 00:00:00'}],page:1,pages:1,total:1},
 '/admin/upstreams':{upstreams:[],fallbackConfigured:false},'/admin/routes':{routes:[]},
 '/admin/desktop/releases':{releases:[]},'/admin/billing/orders':{orders:[]},
 '/admin/billing/plan':{plan:{price_cents:1000,included_credits:10},paymentAvailable:true,notifyConfigured:true}
};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 if(url.pathname.startsWith('/api/')){
  res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
  const route=url.pathname.slice(4);if(route.includes('invite')||route.includes('audit'))throw Error('Removed API still requested: '+route);if(!authorized){res.statusCode=403;return res.end(JSON.stringify({error:'需要管理员权限。'}));}
  if(req.method!=='GET'){writes++;res.statusCode=400;return res.end(JSON.stringify({error:'测试：参数验证失败'}));}
  if(route==='/admin/metering'){if(meterFailure){res.statusCode=503;return res.end(JSON.stringify({error:'测试：服务暂时不可用'}));}return res.end(JSON.stringify({settings:{multiplier_ppm:300000,usd_cny_ppm:7000000,default_model:models[0].id},models,ledger:empty?[]:[{id:'test-request',created_at:'2026-09-12 10:30:00',model:models[0].id,channel:'web_chat',state:'completed',cost_micros:12345,charged_micros:12345,usage_json:'{"input_tokens":1000}',snapshot:JSON.stringify(price)}]}));}
  return res.end(JSON.stringify(fixture[route]||{}));
 }
 const file=url.pathname==='/'?'admin.html':url.pathname.slice(1);
 if(!['admin.html','admin.css','admin-layout.css','admin.js','admin-platform.js','admin-metering.js'].includes(file)){res.statusCode=404;return res.end();}
 res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(root,file)));
});
const pause=ms=>new Promise(r=>setTimeout(r,ms)),run=(w,js)=>w.webContents.executeJavaScript(js,true);
async function until(w,js){for(let i=0;i<60;i++){if(await run(w,js))return;await pause(50);}throw Error('Timed out: '+js);}
app.whenReady().then(async()=>{let win;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/admin.html';
 win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});win.showInactive();const errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level===3&&!/403|503|400|404/.test(message))errors.push(message);});
 await win.loadURL(url+'#metering');await until(win,"!!document.querySelector('[data-settings]')");
 await run(win,"document.querySelector('.model-card summary .table-button:not(.danger)').click()");
 assert.equal(await run(win,"document.querySelector('.model-editor').open"),true);
 assert.equal(await run(win,"document.querySelector('.model-editor').getBoundingClientRect().width>200"),true);
 fs.writeFileSync(path.join(out,'model-editor.png'),(await win.webContents.capturePage()).toPNG());
 await run(win,"document.querySelector('.model-editor').close()");
 for(const width of [1440,1024,390])for(const theme of ['light','dark']){
  win.setContentSize(width,950);await run(win,"if(document.documentElement.dataset.theme!=="+JSON.stringify(theme)+")document.querySelector('#admin-theme-toggle').click()");
  for(const view of ['overview','upstreams','metering','accounts','billing','releases']){
   await run(win,"location.hash="+JSON.stringify('#'+view));await pause(150);
   assert.equal(await run(win,"document.querySelector('[data-admin-nav="+view+"]').getAttribute('aria-current')"),'page');
   assert.equal(await run(win,'document.documentElement.scrollWidth>innerWidth'),false,view+'/'+width+'/'+theme);
   if(['overview','metering','accounts'].includes(view))fs.writeFileSync(path.join(out,view+'-'+width+'-'+theme+'.png'),(await win.webContents.capturePage()).toPNG());
  }
 }
 await run(win,"location.hash='#metering'");await pause(150);await until(win,"!!document.querySelector('[data-settings]')&&!document.querySelector('[data-admin-view=metering]').hasAttribute('aria-busy')");
 await run(win,"document.querySelectorAll('.meter-tabs button')[1].click();document.querySelector('[data-settings] [name=multiplier]').value='0.4';document.querySelector('[data-settings]').requestSubmit()");await until(win,"document.querySelector('[data-meter-status]').textContent.includes('保存失败')");assert.equal(writes,1);assert.equal(await run(win,"document.querySelector('[data-settings] [name=multiplier]').value"),'0.4');
 meterFailure=true;await run(win,"document.querySelector('[data-reload]').click()");await until(win,"document.querySelector('[data-admin-view=metering]').textContent.includes('暂时无法加载')");
 meterFailure=false;empty=true;await run(win,"document.querySelector('[data-reload]').click()");await until(win,"document.querySelector('[data-admin-view=metering]').textContent.includes('暂无请求记录')");
 await run(win,"location.hash='#accounts'");await pause(150);await run(win,"document.querySelector('[data-grant-balance]').click()");assert.equal(await run(win,"document.querySelector('#grant-dialog').open"),true);await run(win,"document.querySelector('#grant-dialog').close()");
 await run(win,"location.hash='#billing'");assert.equal(await run(win,"!!document.querySelector('[data-admin-view=billing] [data-settings]')"),false);
 authorized=false;await win.loadURL(url);await until(win,"document.querySelector('#admin-status').textContent.includes('需要管理员权限')");assert.equal(await run(win,"document.querySelector('#admin-dashboard').hidden"),true);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({verifiedAt:new Date().toISOString(),ok:true,views:6,widths:[1440,1024,390],themes:2,checks:['navigation','overflow','failed form retains input','retry','empty ledger','admin access gate'],errors},null,2));console.log('Admin visual and interaction checks passed');win.destroy();server.close();setTimeout(()=>app.exit(0),300);
 }catch(error){fs.writeFileSync(path.join(out,'failure.txt'),String(error.stack));console.error(error);win?.destroy();server.close();setTimeout(()=>app.exit(1),300);}});
