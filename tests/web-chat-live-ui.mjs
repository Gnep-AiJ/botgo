import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createWebChatRuntime} from './fixtures/web-chat-runtime.mjs';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/49978/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir='artifacts/verification/web-chat/auto-images';fs.mkdirSync(dir,{recursive:true});
const runtime=await createWebChatRuntime({imagesFixture:true,searchFixture:true}),originalUpstream=globalThis.fetch;
const errors=[];
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost:'+server.address().port);
  if(!url.pathname.startsWith('/api/')){const file=path.resolve('.'+(url.pathname==='/'?'/chat.html':url.pathname));if(!file.startsWith(process.cwd()+path.sep))throw Error('Invalid path');const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'};res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const response=await runtime.pagesFetch(new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})}));
  res.writeHead(response.status,Object.fromEntries(response.headers));res.flushHeaders();
  if(response.body){const reader=response.body.getReader();for(;;){const {done,value}=await reader.read();if(done)break;if(!res.destroyed)res.write(value);}}
  res.end();
 }catch(error){if(!res.destroyed)res.destroy(error);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://localhost:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/chat.html');await page.locator('#account-button').click();await page.locator('#email').fill('a@example.invalid');await page.locator('#auth-submit').click();await page.locator('#code').waitFor({state:'visible'});await page.locator('#code').fill(runtime.codes.get('a@example.invalid'));await page.locator('#auth-submit').click();
 await page.waitForFunction(()=>document.getElementById('model').options.length===2);
 assert.equal(await page.locator('#web-search').textContent(),'按需联网');assert.equal(await page.locator('#web-search').evaluate(n=>n.tagName),'SPAN');
 const balance=()=>runtime.db.prepare("SELECT credit_balance*10000+credit_remainder_micros n,billing_reserved_micros reserved FROM accounts WHERE id='fixture-a'").get();
 const initial=balance();runtime.setUpstreamMode('hold');
 await page.locator('#chat-input').fill('停止等待');await page.locator('#send').click();await page.locator('#stop').waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelector('.message-assistant'));
 const before=runtime.upstreamCalls.length;await page.waitForTimeout(150);await page.locator('#stop').click();
 await page.locator('#stop').waitFor({state:'hidden'});await page.getByText('已停止',{exact:true}).first().waitFor();await runtime.settle();assert.deepEqual(balance(),initial);assert.equal(runtime.db.prepare("SELECT COUNT(*) n FROM upstream_leases WHERE state='active'").get().n,0);
 assert.ok(runtime.upstreamCalls.length>=before);
 await page.screenshot({path:dir+'/stop-confirmed.png'});
 // A genuinely incremental HTTP response: do not buffer SSE before Chrome sees it.
 globalThis.fetch=async(url,init)=>{runtime.upstreamCalls.push(JSON.parse(init.body));let c;init.signal.addEventListener('abort',()=>{try{c.error(init.signal.reason);}catch{}},{once:true});return new Response(new ReadableStream({start(controller){c=controller;c.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"持续输出中的回答"}\n\n'));},cancel(){}}),{headers:{'content-type':'text/event-stream'}});};
 await page.locator('#chat-input').fill('停止流式回答');await page.locator('#send').click();await page.locator('.message-assistant').last().getByText('持续输出中的回答',{exact:true}).waitFor();await page.locator('#stop').click();await page.locator('#stop').waitFor({state:'hidden'});await runtime.settle();assert.deepEqual(balance(),initial);
 globalThis.fetch=async(url,init)=>{
  if(String(url).endsWith('/images/generations')&&fs.existsSync('artifacts/verification/web-chat/images/upstream-image.png')){runtime.upstreamCalls.push(JSON.parse(init.body));return Response.json({data:[{b64_json:fs.readFileSync('artifacts/verification/web-chat/images/upstream-image.png').toString('base64')}],usage:{input_tokens:17,input_tokens_details:{text_tokens:17},output_tokens:272,output_tokens_details:{image_tokens:272}}});}
  return originalUpstream(url,init);
 };runtime.setUpstreamMode('normal');
 assert.equal(await page.locator('#image-mode').count(),0);assert.equal(await page.locator('#image-options').count(),0);await page.locator('#chat-input').fill('画一个蓝色机器人');await page.locator('#send').click();
 await page.locator('.generated-image img').waitFor();await page.waitForFunction(()=>document.querySelector('.generated-image img')?.naturalWidth>0);await runtime.settle();const charged=balance();assert.ok(charged.n<initial.n);assert.equal(charged.reserved,0);
 await page.locator('.image-preview').click();assert.ok(await page.locator('#image-dialog').isVisible());assert.match(await page.locator('#image-download').getAttribute('href'),/download=1/);await page.locator('#image-preview-close').click();
 await page.reload();await page.locator('.generated-image img').waitFor();assert.deepEqual(balance(),charged,'reload never regenerates');
 // Restored running answers still expose Stop after the browser loses its controller.
 runtime.db.exec("INSERT INTO web_chat_turns(request_id,conversation_id,content,model,state) SELECT 'restored-running-123456',id,'后台生成','gpt-6.1-sol','running' FROM web_conversations LIMIT 1");
 await page.reload();await page.locator('#stop').waitFor({state:'visible'});await page.locator('#stop').click();await page.locator('#stop').waitFor({state:'hidden'});
 globalThis.fetch=originalUpstream;runtime.setUpstreamMode('reject');await page.locator('#chat-input').fill('画一幅未完成的画面');await page.locator('#send').click();await page.locator('.message-retry').last().waitFor();await runtime.settle();assert.deepEqual(balance(),charged);runtime.setUpstreamMode('normal');await page.locator('.message-retry').last().click();await page.waitForFunction(()=>document.querySelectorAll('.generated-image img').length===2&&!document.getElementById('send').hidden);await runtime.settle();
 for(const width of [1280,375,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>{if(document.documentElement.dataset.theme!==t)document.getElementById('theme-toggle').click();},theme);
  if(width<=700)await page.waitForFunction(()=>document.getElementById('sidebar').getBoundingClientRect().right<=0);
  await page.waitForTimeout(250);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:dir+`/images-${theme}-${width}.png`});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(dir+'/live-ui.json',JSON.stringify({passed:true,checks:['real HTTP streaming','stop before headers','stop mid-stream','restored running stop','atomic refund and lease release','auto search indicator','image preview','history reload without regeneration','failed image retry','1280/375/320 light/dark'],errors},null,2));console.log('Real HTTP Chrome: stop waiting/streaming/restored turn, image preview/history/retry and both themes/mobile passed');
}finally{globalThis.fetch=originalUpstream;await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await runtime.settle();runtime.close();}
