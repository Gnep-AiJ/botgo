// Isolated browser API fixtures: tests Web history controls, never production accounts.
const {app,BrowserWindow}=require('electron');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('artifacts/verification/history-ui');fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();
const rows=new Map();let activeAccount='alice',generationCount=0;const errors=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const server=http.createServer(async(req,res)=>{
 try {
  const url=new URL(req.url,'http://localhost'),route=url.pathname;
  if(!route.startsWith('/api/')){const upstream=await fetch(`http://127.0.0.1:4173${req.url}`);res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'text/plain'});res.end(Buffer.from(await upstream.arrayBuffer()));return;}
  res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
  const send=data=>res.end(JSON.stringify(data));
  if(route==='/api/account')return send({account:{id:activeAccount,email:`${activeAccount}@example.invalid`,balanceCents:102000}});
  if(route==='/api/models')return send({defaultModel:'gpt-5.6-sol',models:[{id:'gpt-5.6-sol',name:'GPT-5.6 Sol',enabled:true,web:true}]});
  let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):{};
  if(route==='/api/conversations'&&req.method==='GET')return send({conversations:[...rows.values()].filter(r=>r.account===activeAccount),hasMore:false});
  if(route==='/api/conversations'&&req.method==='POST'){const row={id:crypto.randomUUID(),title:body.title,messages:[],account:activeAccount};rows.set(row.id,row);return send(row);}
  if(route==='/api/chat/stream'){
   const row=rows.get(body.conversationId);assert.equal(row.account,activeAccount);assert.ok(body.requestId);generationCount++;
   row.messages.push({role:'user',content:body.content},{role:'assistant',content:'**云端保存测试回复**',model:body.model,state:'completed'});
   res.setHeader('content-type','text/event-stream');return res.end('data: {"choices":[{"delta":{"content":"**云端保存测试回复**"}}]}\n\ndata: [DONE]\n\n');
  }
  if(route.startsWith('/api/conversations/')){const id=route.split('/').pop(),row=rows.get(id);if(!row||row.account!==activeAccount){res.statusCode=404;return send({error:'对话不存在'});}if(req.method==='DELETE'){rows.delete(id);return send({ok:true});}return send(row);}
  return send({});
 }catch(e){errors.push(String(e));res.statusCode=500;res.end('{}');}
});
const run=(win,js)=>win.webContents.executeJavaScript(js,true);
const waitFor=async(win,expression)=>{for(let i=0;i<60;i++){if(await run(win,expression))return;await pause(50);}throw new Error(`Timed out: ${expression}`);};
async function click(win,selector){const point=await run(win,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),hit:e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))};})()`);assert.equal(point.hit,true,selector);win.webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x:point.x,y:point.y,button:'left',clickCount:1});await pause(80);}
app.whenReady().then(async()=>{
 const wins=[];
 try{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/workspace.html`;
  const make=()=>{const w=new BrowserWindow({width:1440,height:950,show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});w.showInactive();wins.push(w);return w;};
  const win=make();await win.loadURL(base);await waitFor(win,`!document.querySelector('#header-balance').hidden&&!document.querySelector('#model-picker').disabled`);
  await run(win,`document.querySelector('#chat-input').value='测试历史记录保存';document.querySelector('#chat-input').dispatchEvent(new Event('input'));document.querySelector('#chat-form').requestSubmit()`);
  await waitFor(win,`document.querySelector('#history-list .history-title')&&document.querySelector('#stop-chat').hidden`);
  await win.loadURL(base);await waitFor(win,`!!document.querySelector('#history-list .history-title')`);await click(win,'#history-list .history-title');await waitFor(win,`document.querySelectorAll('.message-body').length===2`);
  assert.match(await run(win,`document.querySelector('#chat-log').textContent`),/云端保存测试回复/);
  fs.writeFileSync(path.join(out,'history-desktop.png'),(await win.webContents.capturePage()).toPNG());
  const other=make();other.setContentSize(390,844);await other.loadURL(base);await waitFor(other,`!!document.querySelector('#history-list .history-title')`);
  await click(other,'.history-open');await click(other,'.mobile-history-list .history-title');await waitFor(other,`document.querySelectorAll('.message-body').length===2`);
  await click(other,'.history-open');fs.writeFileSync(path.join(out,'history-mobile.png'),(await other.webContents.capturePage()).toPNG());
  await click(other,'.mobile-history-list .history-delete');await click(other,'[data-cancel]');assert.equal(rows.size,1);
  await click(other,'.mobile-history-list .history-delete');await click(other,'[data-confirm]');await waitFor(other,`!document.querySelector('#history-list .history-title')`);assert.equal(rows.size,0);assert.equal(generationCount,1);
  await other.loadURL(base);await waitFor(other,`document.querySelector('#history-status').textContent==='暂无历史对话'`);
  activeAccount='bob';await win.loadURL(base);await waitFor(win,`document.querySelector('#history-status').textContent==='暂无历史对话'`);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({verifiedAt:new Date().toISOString(),ok:true,checks:['send','reload','second window','mobile history','cancel deletion','delete','reload deleted','account switch'],generationCount,errors},null,2));
  console.log('Web history browser checks passed');
  for(const w of wins)w.destroy();server.close();setTimeout(()=>app.exit(0),300);
 }catch(e){fs.writeFileSync(path.join(out,'failure.txt'),String(e.stack));console.error(e);for(const w of wins)w.destroy();server.close();setTimeout(()=>app.exit(1),300);}
});
