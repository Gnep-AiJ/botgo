import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createWebChatRuntime} from './fixtures/web-chat-runtime.mjs';
import {citedAnswer} from '../worker/src/web-search.js';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/49978/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const output=process.env.BOTGO_SEARCH_ARTIFACT_DIR||'artifacts/verification/web-chat/native-search';fs.mkdirSync(output,{recursive:true});const runtime=await createWebChatRuntime({searchFixture:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('https://botgo.test/**',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(!url.pathname.startsWith('/api/')){const filename=url.pathname.slice(1)||'chat.html',types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.webp':'image/webp'};return route.fulfill({contentType:types[path.extname(filename)],body:fs.readFileSync(filename)});}
  const response=await runtime.pagesFetch(new Request(url,{method:req.method(),headers:await req.allHeaders(),...(!['GET','HEAD'].includes(req.method())?{body:req.postData()}:{})}));const body=Buffer.from(await response.arrayBuffer());await runtime.settle();await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body});
 });
 await page.goto('https://botgo.test/chat.html');assert.ok(await page.locator('#web-search').isHidden());
 await page.locator('#account-button').click();await page.locator('#email').fill('a@example.invalid');await page.locator('#auth-submit').click();await page.locator('#code').waitFor({state:'visible'});await page.locator('#code').fill(runtime.codes.get('a@example.invalid'));await page.locator('#auth-submit').click();
 await page.waitForFunction(()=>document.getElementById('model').options.length===2);assert.equal(await page.locator('#model').inputValue(),'gpt-6.1-sol');assert.equal(await page.locator('#web-search').textContent(),'按需联网');assert.equal(await page.locator('#web-search').evaluate(n=>n.tagName),'SPAN');
 await page.locator('#model').selectOption(runtime.models[0].id);assert.ok(await page.locator('#web-search').isHidden());await page.locator('#model').selectOption('gpt-6.1-sol');assert.ok(await page.locator('#web-search').isVisible());
 await page.locator('#chat-input').fill('查找官方资料');await page.locator('#send').click();await page.locator('.message-assistant a').waitFor();
 const href='https://developers.cloudflare.com/workers/configuration/compatibility-dates/';assert.equal(await page.locator('.message-assistant a').getAttribute('href'),href);assert.equal(await page.locator('.message-assistant a').getAttribute('rel'),'noopener noreferrer');assert.equal(await page.locator('#fee,#usage,.fee').count(),0);
 const actualUsage=runtime.db.prepare("SELECT usage_json FROM metered_requests WHERE channel='web_chat'").get();assert.equal(JSON.parse(actualUsage.usage_json).tool_usage.web_search.num_requests,1);
 await page.reload();await page.locator('.message-assistant a').waitFor();assert.equal(await page.locator('.message-assistant a').getAttribute('href'),href);assert.ok(await page.locator('#web-search').isVisible());
 runtime.setUpstreamMode('search-none');await page.locator('#chat-input').fill('你好');await page.locator('#send').click();await page.waitForFunction(()=>!document.getElementById('send').hidden);await runtime.settle();assert.equal(JSON.parse(runtime.db.prepare("SELECT usage_json FROM metered_requests ORDER BY rowid DESC LIMIT 1").get().usage_json).tool_usage.web_search.num_requests,0,'successful answer may omit search');
 const annotations={output:[{content:[{annotations:[{type:'url_citation',url:href,title:'[Compatibility] (dates)'},{type:'url_citation',url:'https://user:pass@example.invalid',title:'bad'},{type:'url_citation',url:'javascript:alert(1)',title:'bad'}]}]}]};assert.equal(await page.evaluate(r=>BotGoUI.citedAnswer('test',r),annotations),citedAnswer('test',annotations),'browser and history source formatting agree');
 const links=await page.evaluate(()=>{const node=document.createElement('div');BotGoUI.markdown(node,'[safe](https://example.invalid/a) [unsafe](javascript:alert(1)) [credentials](https://user:pass@example.invalid/) `<script>`');return [...node.querySelectorAll('a')].map(a=>a.href);});assert.deepEqual(links,['https://example.invalid/a']);
 for(const width of [1280,375,320])for(const theme of ['light','dark']){
  await page.setViewportSize({width,height:900});await page.evaluate(t=>{if(document.documentElement.dataset.theme!==t)document.getElementById('theme-toggle').click();},theme);if(width<=700)await page.locator('#sidebar-toggle').click();await page.locator('#new-chat').click();
  if(width<=700)await page.waitForFunction(()=>document.getElementById('sidebar').getBoundingClientRect().right<=0);
  assert.ok(await page.locator('#web-search').isVisible());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:output+`/search-${theme}-${width}.png`});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(output+'/ui-result.json',JSON.stringify({passed:true,checks:['real fixture auth','initial verified model','automatic search','zero-search answer succeeds','source links','source history reload','no billing UI','unsafe URL filtering','1280/375/320 light/dark'],errors},null,2));console.log('Chrome automatic search, authenticated adapter, citations/history, both themes/mobile passed');
}finally{await browser.close();await runtime.settle();runtime.close();}
