import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createWebChatRuntime} from './fixtures/web-chat-runtime.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.BOTGO_PLAYWRIGHT_PATH||'C:/Users/49978/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir='artifacts/verification/web-chat/auto-images';fs.mkdirSync(dir,{recursive:true});
const mediaDir='artifacts/verification/web-chat/attachments';fs.mkdirSync(mediaDir,{recursive:true});
const csp=fs.readFileSync('_headers','utf8').match(/Content-Security-Policy: ([^\r\n]+)/)[1];
const runtime=await createWebChatRuntime({imagesFixture:true,searchFixture:true}),originalUpstream=globalThis.fetch;
const errors=[];
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost:'+server.address().port);
  if(!url.pathname.startsWith('/api/')){const file=path.resolve('.'+(url.pathname==='/'?'/chat.html':url.pathname));if(!file.startsWith(process.cwd()+path.sep))throw Error('Invalid path');const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'};res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.setHeader('Content-Security-Policy',csp);res.end(fs.readFileSync(file));return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const response=await runtime.pagesFetch(new Request(url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Buffer.concat(chunks)}:{})}));
  res.writeHead(response.status,Object.fromEntries(response.headers));res.flushHeaders();
  if(response.body){const reader=response.body.getReader();for(;;){const {done,value}=await reader.read();if(done)break;if(!res.destroyed)res.write(value);}}
  res.end();
 }catch(error){if(!res.destroyed)res.destroy(error);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://localhost:'+server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.BOTGO_CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
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

 await page.setViewportSize({width:1280,height:900});
 await page.locator('button[data-topic="doctor"]').click();
 const imageBytes=await page.evaluate(async()=>{
   const canvas=document.createElement('canvas');canvas.width=180;canvas.height=110;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#f2e9d8';ctx.fillRect(0,0,180,110);
   ctx.fillStyle='#2e6689';ctx.fillRect(22,25,70,50);ctx.fillStyle='#cb6245';ctx.fillRect(110,35,40,35);
   return Array.from(new Uint8Array(await (await new Promise(resolve=>canvas.toBlob(resolve))).arrayBuffer()));
 });
 await page.locator('#chat-files').setInputFiles({name:'unsupported.txt',mimeType:'text/plain',buffer:Buffer.from('fixture')});
 await page.getByText('支持 JPG、PNG、WebP 图片和 MP4、WebM、MOV 视频。',{exact:true}).waitFor();
 const fileTransfer=await page.evaluateHandle(bytes=>{
   const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],'示例.png',{type:'image/png'}));return transfer;
 },imageBytes);
 await page.evaluate(clipboardData=>document.getElementById('chat-input').dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true})),fileTransfer);
 await page.locator('#chat-attachments .chat-attachment').waitFor();
 await page.getByRole('button',{name:'移除 示例.png'}).click();
 await page.locator('#chat-attachments').waitFor({state:'hidden'});
 await page.evaluate(dataTransfer=>document.getElementById('chat-form').dispatchEvent(new DragEvent('drop',{dataTransfer,bubbles:true,cancelable:true})),fileTransfer);
 await page.locator('#chat-attachments .chat-attachment').waitFor();
 await fileTransfer.dispose();

 const chooser=page.waitForEvent('filechooser');
 await page.getByRole('button',{name:'添加图片或视频'}).click();
 await (await chooser).setFiles('tests/fixtures/web-chat-visual-sample.webm');
 await page.getByText('视频画面 · 2 帧',{exact:true}).waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('#chat-attachments img')].every(img=>img.naturalWidth>0));
 assert.equal(await page.locator('#chat-input').inputValue(),'');
 assert.equal(await page.locator('#send').isEnabled(),true,'media alone can be sent');
 await page.screenshot({path:mediaDir+'/compose-desktop.png'});
 await page.setViewportSize({width:320,height:640});
 await page.waitForFunction(()=>document.getElementById('sidebar').getBoundingClientRect().right<=0);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:mediaDir+'/compose-mobile.png'});
 await page.locator('#send').click();
 const firstUserMessage=page.locator('.message-user .message-content');
 await firstUserMessage.waitFor();
 assert.match(await firstUserMessage.textContent(),/请描述附件中的内容。/);
 await page.locator('.message-user .attachment-preview img').last().waitFor();
 await page.waitForFunction(()=>!document.getElementById('send').hidden);
 const actualParts=runtime.upstreamCalls.at(-1).input.at(-1).content;
 const visualImages=actualParts.filter(part=>part.type==='input_image');
 assert.equal(visualImages.length,3,'the upstream receives the picture and both video frames');
 assert.notEqual(visualImages[1].image_url,visualImages[2].image_url,'video samples show different moments');
 await page.reload();
 await page.waitForFunction(()=>document.querySelectorAll('.message-user .attachment-preview img').length===2&&[...document.querySelectorAll('.message-user .attachment-preview img')].every(img=>img.naturalWidth>0));
 await page.getByRole('button',{name:/查看视频首帧/}).click();
 assert.ok(await page.locator('#image-dialog').isVisible());
 await page.locator('#image-preview-close').click();
 await page.locator('#chat-input').fill('前面内容里还有哪些细节？');await page.locator('#send').click();
 await page.waitForFunction(()=>document.querySelectorAll('.message-assistant').length===2&&!document.getElementById('send').hidden);
 assert.ok(runtime.upstreamCalls.at(-1).input.some(message=>Array.isArray(message.content)&&message.content.filter(part=>part.type==='input_image').length===3));
 await page.screenshot({path:mediaDir+'/follow-up-mobile.png'});

 runtime.setUpstreamMode('reject');
 await page.locator('#chat-files').setInputFiles({name:'重试示例.png',mimeType:'image/png',buffer:Buffer.from(imageBytes)});
 await page.getByRole('button',{name:'移除 重试示例.png'}).waitFor();
 await page.locator('#send').click();await page.locator('.message-retry').waitFor();
 await page.reload();await page.locator('.message-retry').waitFor();
 runtime.setUpstreamMode('normal');
 await page.locator('.message-retry').click();
 await page.waitForFunction(()=>document.querySelectorAll('.message-assistant').length===4&&!document.getElementById('send').hidden);
 assert.equal(runtime.upstreamCalls.at(-1).input.at(-1).content.filter(part=>part.type==='input_image').length,1,'retry reloads the stored attachment');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(mediaDir+'/result.json',JSON.stringify({passed:true,browser:'Chrome',checks:['file picker','clipboard image','drag and drop','invalid format','attachment-only send','two different video samples','authenticated history and preview','visual follow-up','retry after reload','1280px and 320px layouts'],errors},null,2));
 console.log('Real HTTP Chrome: picture and sampled video in the same composer, restored preview and follow-up passed');
}finally{globalThis.fetch=originalUpstream;await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await runtime.settle();runtime.close();}
