// Credential-free browser evidence for discovery, price refresh and gated import.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'artifacts/verification/grok-contact-upgrade/model-ui');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();
const profileId='11111111-1111-4111-8111-111111111111';
const price={input:2,output:10},official=id=>({id,name:id,provider:id.startsWith('grok-')?'xAI':'Anthropic',price:id.startsWith('grok-')?{input:2,output:6}:price});
let published=[{id:'claude-sonnet-5',name:'Claude Sonnet 5',enabled:true,price}],fail=false,savedPrices=[];const batches=[],imports=[],listCalls=[];
const ids=['claude-sonnet-5','claude-sonnet-5-5','claude-opus-5-5','claude-test-9','claude-test-8','claude-test-7','claude-test-6','gpt-6-sol','gpt-image-1k-th','gpt-image-2','gpt-image-2.5-flare'];
const otherId='22222222-2222-4222-8222-222222222222';
const billingModels=[{id:'gpt-image-2',name:'GPT Image 2'},{id:'gpt-image-2.5-flare',name:'GPT Image 2.5 Flare'}];
const imagePrice={textInput:5,textCached:1.25,imageInput:8,imageCached:2,imageOutput:30};
const item=id=>({id,official:id==='claude-sonnet-5'||id==='gpt-6-sol'||id==='grok-4.6'?official(id):null,reference:id==='gpt-image-2'||id==='gpt-image-2.5-flare'?{imagePrice}:null,imageEligible:id.startsWith('gpt-image-'),billingModels});
const fixtures={'/admin/overview':{admin:{email:'fixture@example.invalid'},overview:{}},'/admin/accounts':{accounts:[],page:1,pages:1,total:0},'/admin/upstreams':{upstreams:[{id:profileId,name:'Kedaya fixture',baseUrl:'https://upstream.invalid/v1',updatedAt:'2026-09-30 00:00:00'},{id:otherId,name:'Other fixture',baseUrl:'https://other.invalid/v1',updatedAt:'2026-09-30 00:00:00'}]},'/admin/opencode':{routes:[]},'/admin/model-services/images':{images:[]}};
const allowed=new Set(['admin.html','admin.css','admin-layout.css','admin.js','admin-platform.js','admin-metering.js','ui-kit.js']);
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');if(url.pathname.startsWith('/api/')){
   res.setHeader('content-type','application/json');const route=url.pathname.slice(4);
   if(route==='/admin/metering')return res.end(JSON.stringify({models:published,settings:{},ledger:[]}));
   if(route==='/admin/model-services/prices')return res.end(JSON.stringify({models:savedPrices}));
   if(route==='/admin/model-services/available'){assert.equal(url.searchParams.get('prices'),'cached');listCalls.push(url.searchParams.get('profileId'));return res.end(JSON.stringify({models:(url.searchParams.get('profileId')===otherId?['grok-4.6','grok-4.7','grok-4.7-build-fast']:ids).map(item)}));}
   if(route==='/admin/model-services/refresh-prices'||route==='/admin/model-services/import'){
     let raw='';req.on('data',b=>raw+=b);req.on('end',()=>{const data=JSON.parse(raw);
       if(route.endsWith('/import')){imports.push(data);published.push({id:data.modelId,name:'Claude Sonnet 5.5',enabled:true,price});return res.end(JSON.stringify({ok:true}));}
       batches.push(data.modelIds);return setTimeout(()=>{res.statusCode=fail?503:200;res.end(JSON.stringify(fail?{error:'官方源暂不可用'}:{models:data.modelIds.map(id=>({id,official:id.startsWith('claude-test')||id==='grok-4.7-build-fast'?null:official(id),reference:null,verification:{status:id==='claude-opus-5-5'?'retained':id.startsWith('claude-test')||id==='grok-4.7-build-fast'?'unverified':'verified'}}))}));},150);
     });return;
   }
   return res.end(JSON.stringify(fixtures[route]||{}));
 }
 const file=url.pathname==='/'?'admin.html':url.pathname.slice(1);if(!allowed.has(file)){res.statusCode=404;return res.end();}
 res.setHeader('content-type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(path.join(root,file)));
});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(win,code){for(let i=0;i<150;i++){if(await win.webContents.executeJavaScript(code))return;await pause(40);}throw Error('UI wait timed out: '+code);}
app.whenReady().then(async()=>{let win;try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));win=new BrowserWindow({width:1280,height:950,show:false,webPreferences:{nodeIntegration:false,contextIsolation:true}});
 const errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message);});await win.loadURL(`http://127.0.0.1:${server.address().port}/#metering`);
 await until(win,"!!document.querySelector('[data-import]')");assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('[data-ai-open]')"),false);
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-import]').textContent"),'更新模型/价格');
 await win.webContents.executeJavaScript("localStorage.clear();document.querySelector('[data-import]').click()");await pause(120);assert.equal(listCalls.length,0);assert.equal(batches.length,0);
 await win.webContents.executeJavaScript("document.querySelector('[data-model-group]').value='claude';document.querySelector('[data-model-group]').dispatchEvent(new Event('change'));document.querySelector('[data-profile]').value='"+profileId+"';document.querySelector('[data-profile]').dispatchEvent(new Event('change'))");
 await until(win,"!document.querySelector('[data-add]').disabled");assert.equal(listCalls.length,1);assert.equal(batches.length,0,'reading list/group must not force official refresh');
 await win.webContents.executeJavaScript("document.querySelector('[data-retry]').click()");await until(win,"document.querySelector('[data-drawer]').dataset.loading==='1'");
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-add]').disabled"),true);
 await until(win,"document.querySelector('[data-progress]').textContent.includes('更新完成')");assert.deepEqual(batches.map(b=>b.length),[5,2]);assert.ok(batches.flat().every(id=>id.startsWith('claude-')),'only selected model group is refreshed');assert.equal(imports.length,0,'discovery must not run paid probes or publish routes');
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-available]').textContent.includes('本次核对失败，保留已核价')"),true);
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('input[value=\"claude-sonnet-5-5\"]').disabled"),false);
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('input[value=\"claude-test-9\"]').disabled"),true);
 await win.webContents.executeJavaScript("document.querySelector('[data-model-group]').value='image';document.querySelector('[data-model-group]').dispatchEvent(new Event('change'))");
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-available]').textContent.includes('gpt-image-1k-th')"),true);
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('input[value=\"gpt-image-1k-th\"]').closest('label').getBoundingClientRect().width>300"),true,'billing selector must not squeeze the label');
 await pause(150);fs.writeFileSync(path.join(out,'desktop.png'),(await win.webContents.capturePage()).toPNG());win.setSize(390,844);await pause(150);
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-drawer]').scrollWidth <= document.querySelector('[data-drawer]').clientWidth+2"),true);fs.writeFileSync(path.join(out,'mobile.png'),(await win.webContents.capturePage()).toPNG());
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('input[value=\"gpt-image-1k-th\"]').closest('label').querySelector('strong').getBoundingClientRect().height<55"),true,'image ID must not wrap one character per line');
 await win.webContents.executeJavaScript("document.querySelector('[data-model-group]').value='claude';document.querySelector('[data-model-group]').dispatchEvent(new Event('change'));document.querySelector('input[value=\"claude-sonnet-5-5\"]').click();document.querySelector('[data-add]').click()");
 await until(win,"!document.querySelector('[data-drawer]').open && document.querySelector('[data-status]').textContent.includes('已添加 1/1')");
 assert.deepEqual(imports,[{profileId,modelId:'claude-sonnet-5-5',protocol:'responses'}]);
 const reads=listCalls.length,refreshes=batches.length;
 await win.webContents.executeJavaScript("document.querySelector('[data-import]').click()");await until(win,"document.querySelector('[data-progress]').textContent.includes('显示已保存列表')");assert.equal(listCalls.length,reads);assert.equal(batches.length,refreshes);
 await win.webContents.executeJavaScript("document.querySelector('[data-profile]').value='"+otherId+"';document.querySelector('[data-profile]').dispatchEvent(new Event('change'));document.querySelector('[data-model-group]').value='grok';document.querySelector('[data-model-group]').dispatchEvent(new Event('change'))");await until(win,"!!document.querySelector('input[value=\"grok-4.6\"]')");assert.equal(batches.length,refreshes);
 await win.webContents.executeJavaScript("document.querySelector('[data-profile]').value='"+profileId+"';document.querySelector('[data-profile]').dispatchEvent(new Event('change'));document.querySelector('[data-model-group]').value='claude';document.querySelector('[data-model-group]').dispatchEvent(new Event('change'))");assert.equal(listCalls.length,reads+1);
 await win.webContents.executeJavaScript("document.querySelector('[data-close]').click()");win.webContents.reload();await until(win,"!!document.querySelector('[data-import]')");await win.webContents.executeJavaScript("document.querySelector('[data-import]').click()");await until(win,"document.querySelector('[data-progress]').textContent.includes('显示已保存列表')");assert.equal(listCalls.length,reads+1,'normal page reload reuses public model list cache');assert.equal(batches.length,refreshes);
 fail=true;await win.webContents.executeJavaScript("document.querySelector('[data-retry]').click()");await until(win,"document.querySelector('[data-progress]').textContent.includes('更新未完成')");
 assert.equal(await win.webContents.executeJavaScript("!!document.querySelector('input[value=\"claude-sonnet-5-5\"]')"),true,'a failed update keeps the saved list');assert.equal(await win.webContents.executeJavaScript("document.querySelector('[data-retry]').disabled"),false);assert.deepEqual(errors,[]);
 fail=false;await win.webContents.executeJavaScript("document.querySelector('[data-profile]').value='"+otherId+"';document.querySelector('[data-profile]').dispatchEvent(new Event('change'));document.querySelector('[data-model-group]').value='grok';document.querySelector('[data-model-group]').dispatchEvent(new Event('change'))");
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('input[value=\"grok-4.7\"]').disabled"),true);
 await win.webContents.executeJavaScript("document.querySelector('[data-retry]').click()");await until(win,"document.querySelector('[data-progress]').textContent.includes('更新完成')");
 assert.deepEqual(batches.at(-1),['grok-4.6','grok-4.7','grok-4.7-build-fast']);
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('input[value=\"grok-4.7\"]').disabled"),false);
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('input[value=\"grok-4.7-build-fast\"]').disabled"),true);
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('input[value=\"grok-4.7\"]').closest('label').textContent.includes('xAI · Standard $2 / $6')"),true);
 const previousBatches=batches.length,previousReads=listCalls.length;
 savedPrices=[{id:'grok-4.7',official:{...official('grok-4.7'),price:{input:2,output:7}},reference:null,verification:{status:'cached'}}];
 await win.webContents.executeJavaScript("document.querySelector('[data-close]').click()");await pause(200);
 await win.webContents.executeJavaScript("document.querySelector('[data-import]').click()");
 await until(win,"document.querySelector('input[value=\"grok-4.7\"]').closest('label').textContent.includes('xAI · Standard $2 / $7')");
 assert.equal(batches.length,previousBatches);assert.equal(listCalls.length,previousReads,'updated backend prices must appear without upstream or official fetch');
 await pause(200);fs.writeFileSync(path.join(out,'grok.png'),(await win.webContents.capturePage()).toPNG());
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({ok:true,listCalls,batches:batches.map(b=>b.length),imports,errors,checks:['choose upstream/group before update','read-only list','reopen and reload reuse cache','per-upstream cache','image name and selector layout','explicit update','free-plan batches','retained price feedback','new model selectable','unverified disabled','gated import','failure retry','desktop and mobile']},null,2));
 console.log('Model price update browser checks passed');win.destroy();server.close();app.exit(0);
 }catch(error){console.error(error.stack);fs.writeFileSync(path.join(out,'failure.txt'),error.stack);if(win){fs.writeFileSync(path.join(out,'failure-body.txt'),await win.webContents.executeJavaScript('document.body.innerText'));fs.writeFileSync(path.join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());}win?.destroy();server.close();app.exit(1);}});
