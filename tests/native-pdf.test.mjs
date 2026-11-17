import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {handleOpenCode} from '../worker/src/opencode-gateway.js';
import {encryptSecret} from '../worker/src/platform-admin.js';
import {MODEL_SEEDS} from '../worker/src/metering.js';
import {officialModel} from '../worker/src/official-pricing.js';
import {nativeCapabilities,NATIVE_REQUEST_MAX_BYTES} from '../worker/src/native-capabilities.js';
const {createBridge,MAX_REQUEST_BYTES}=createRequire(import.meta.url)('../opencode-desktop/runtime/bridge.cjs');
assert.equal(MAX_REQUEST_BYTES,NATIVE_REQUEST_MAX_BYTES);
assert.deepEqual(nativeCapabilities(officialModel('gpt-6-sol')).modalities.input,['text','image','pdf']);
assert.deepEqual(nativeCapabilities(officialModel('gpt-6-sol'),['text','image']).modalities.input,['text','image'],'legacy clients only receive modalities they understand');
assert.deepEqual(nativeCapabilities({provider:'xAI',modalities:{input:['text','image'],output:['text']}}).modalities.input,['text','image']);
assert.deepEqual(nativeCapabilities({provider:'Other',modalities:{input:['text','audio','video','pdf'],output:['text','audio']}}).modalities,{input:['text','audio','video','pdf'],output:['text','audio']});
assert.equal(officialModel('gpt-6-sol').modalities.input.includes('pdf'),false,'API transport adaptation does not mutate official source metadata');
const sql=new DatabaseSync(':memory:');
for(const file of fs.readdirSync('worker/migrations').filter(f=>f.endsWith('.sql')).sort())sql.exec(fs.readFileSync(`worker/migrations/${file}`,'utf8'));
function statement(query){let values=[];return {bind(...args){values=args;return this;},async first(){return sql.prepare(query).get(...values)||null;},async all(){return {results:sql.prepare(query).all(...values)};},async run(){return {meta:{changes:Number(sql.prepare(query).run(...values).changes)}};}};}
const env={UPSTREAM_CONFIG_KEY:Buffer.alloc(32,8).toString('base64url'),DB:{prepare:statement,async batch(statements){sql.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sql.exec('COMMIT');return results;}catch(e){sql.exec('ROLLBACK');throw e;}}}};
sql.exec("INSERT INTO accounts(id,email,password_hash,credit_balance) VALUES('a','pdf@example.invalid','unused',100000)");
const encrypted=await encryptSecret('fixture-secret',env);
sql.prepare("INSERT INTO upstream_profiles(id,name,base_url,api_key_ciphertext,api_key_iv,key_hint) VALUES('p','fixture','https://upstream.invalid/v1',?,?,'fixture')").run(encrypted.ciphertext,encrypted.iv);
for(const [id,protocol] of [['gpt-6-sol','chat'],['gpt-5.6-sol','responses']]){
  const model=MODEL_SEEDS.find(m=>m.id===id);
  sql.prepare('INSERT INTO model_catalog(id,name,upstream_id,price_json,enabled,agent_enabled) VALUES(?,?,?,?,1,1)').run(id,model.name,id,JSON.stringify(model.price));
  sql.prepare("INSERT INTO agent_model_routes(model_id,profile_id,protocol,enabled,verified_at) VALUES(?,'p',?,1,CURRENT_TIMESTAMP)").run(id,protocol);
}
const device='bgdt_pdf_fixture';
const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(device))).toString('base64url');
sql.prepare("INSERT INTO device_tokens(token_hash,account_id,label,expires_at) VALUES(?,'a','fixture',?)").run(hash,new Date(Date.now()+86400000).toISOString());
const jobs=[],ctx={waitUntil(p){jobs.push(p);}},realFetch=globalThis.fetch,calls=[];
let bridge,issuedSession,upstreamInput=1200;
try{
  globalThis.fetch=async(url,init)=>{
    assert.equal(init.headers.authorization,'Bearer fixture-secret');
    const payload=JSON.parse(init.body);calls.push({url,payload});
    return new Response(url.endsWith('/responses')?'data: '+JSON.stringify({type:'response.completed',response:{usage:{input_tokens:upstreamInput,output_tokens:5}}})+'\n\n':'data: '+JSON.stringify({usage:{prompt_tokens:upstreamInput,completion_tokens:5}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
  };
  const legacy=await handleOpenCode(new Request('https://botgo.test/api/desktop/opencode/session',{method:'POST',headers:{authorization:'Bearer '+device}}),env,ctx,'/desktop/opencode/session');
  assert.equal(legacy.status,201);
  for(const model of (await legacy.json()).models)assert.deepEqual(model.modalities.input,['text','image'],'existing clients can sign in and reach the updater without new modality fields');
  bridge=await createBridge({origin:'https://botgo.test',deviceToken:device,fetchImpl:async(url,init)=>{
    const route=new URL(url).pathname.replace(/^\/api/,'');
    const response=await handleOpenCode(new Request(url,init),env,ctx,route);
    if(route==='/desktop/opencode/session'){
      assert.equal(init.headers['x-botgo-native-modalities'],'text,image,audio,video,pdf');
      issuedSession=await response.clone().json();
    }
    return response;
  }});
  const cfg=bridge.config();
  assert.deepEqual(cfg.enabled_providers,['botgo-chat','botgo-responses']);
  for(const protocol of ['chat','responses'])assert.ok(cfg.provider[`botgo-${protocol}`].models[protocol==='chat'?'gpt-6-sol':'gpt-5.6-sol'].modalities.input.includes('pdf'));
  // A >1 MB upload crosses the real authenticated local HTTP bridge, Worker
  // bounded JSON reader, encrypted route and metering pipeline byte-for-byte.
  const file='data:application/pdf;base64,'+Buffer.from('%PDF-1.4\n'+ 'binary-upload-fixture\n'.repeat(70000)+'%%EOF').toString('base64');
  for(const protocol of ['chat','responses']){
    const {baseURL,apiKey}=cfg.provider[`botgo-${protocol}`].options;
    const pdf=protocol==='chat'?{type:'file',file:{filename:'含空格 测试.pdf',file_data:file}}:{type:'input_file',filename:'含空格 测试.pdf',file_data:file};
    const body=protocol==='chat'?{model:'gpt-6-sol',max_completion_tokens:20000,messages:[{role:'user',content:[pdf,{type:'text',text:'Read the PDF'}]}]}:{model:'gpt-5.6-sol',max_output_tokens:20000,input:[{role:'user',content:[pdf,{type:'input_text',text:'Read the PDF'}]}]};
    assert.ok(Buffer.byteLength(JSON.stringify(body))>1000000);
    const send=async(value,extra={})=>{const response=await realFetch(baseURL+(protocol==='chat'?'/chat/completions':'/responses'),{method:'POST',signal:AbortSignal.timeout(20000),headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json','x-opencode-session-id':`ses_${protocol}_child`,'x-opencode-parent-session-id':'ses_pdf_root',...extra},body:JSON.stringify(value)});return new Response(await response.text(),{status:response.status,headers:response.headers});};
    const result=await send(body);assert.equal(result.status,200,await result.clone().text());await result.text();await Promise.all(jobs);
    const sent=calls.at(-1).payload,actual=protocol==='chat'?sent.messages[0].content[0]:sent.input[0].content[0];
    assert.deepEqual(actual,pdf,'PDF filename and bytes survive without text replacement');
    assert.equal(sent[protocol==='chat'?'max_completion_tokens':'max_output_tokens'],20000,'native output is not silently clamped to 16384');
    const ledger=sql.prepare('SELECT * FROM metered_requests ORDER BY rowid DESC LIMIT 1').get();
    assert.equal(JSON.parse(ledger.snapshot).taskId,'ses_pdf_root');assert.equal(ledger.state,'completed');assert.ok(ledger.charged_micros>0);
    assert.deepEqual(JSON.parse(ledger.usage_json),protocol==='chat'?{prompt_tokens:1200,completion_tokens:5}:{input_tokens:1200,output_tokens:5});
    const count=calls.length,rows=sql.prepare('SELECT COUNT(*) AS n FROM metered_requests').get().n;
    console.log(`PDF ${protocol}: settlement passed; checking rejection boundaries`);
    assert.equal((await send(body,{'x-session-id':'different'})).status,400,'conflicting modern and legacy IDs cannot misattribute billing');
    assert.equal((await send({...body,large:'x'.repeat(MAX_REQUEST_BYTES)})).status,413);
    assert.equal((await send(body,{authorization:'Bearer invalid'})).status,401);
    assert.equal(calls.length,count);assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM metered_requests').get().n,rows,'rejected uploads never reserve or charge');
    const workerOversize=await handleOpenCode(new Request('https://botgo.test/opencode/v1/responses',{method:'POST',headers:{authorization:'Bearer fixture'},body:'x'.repeat(MAX_REQUEST_BYTES+1)}),env,ctx,'/opencode/v1/responses');
    assert.equal(workerOversize.status,401,'authentication precedes upload parsing');
    const authenticatedOversize=await handleOpenCode(new Request('https://botgo.test/opencode/v1/responses',{method:'POST',headers:{authorization:'Bearer '+issuedSession.key},body:'x'.repeat(MAX_REQUEST_BYTES+1)}),env,ctx,'/opencode/v1/responses');
    assert.equal(authenticatedOversize.status,413,'Worker independently bounds authenticated uploads');
    assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM metered_requests').get().n,rows);
  }
  // Tiny compressed documents can expand to many page-image tokens. A byte
  // estimate must not under-reserve and turn a successful upload into debt.
  upstreamInput=160000;
  const {baseURL,apiKey}=cfg.provider['botgo-chat'].options;
  const tiny=await realFetch(baseURL+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+apiKey,'content-type':'application/json','x-opencode-session-id':'ses_tiny','x-opencode-parent-session-id':'ses_pdf_root'},body:JSON.stringify({model:'gpt-6-sol',max_completion_tokens:256,messages:[{role:'user',content:[{type:'file',file:{filename:'compressed.pdf',file_data:'data:application/pdf;base64,JVBERi0xLjQ='}}]}]})});
  assert.equal(tiny.status,200);await tiny.text();await Promise.all(jobs);
  const compressed=sql.prepare('SELECT reserved_micros,charged_micros,state FROM metered_requests ORDER BY rowid DESC LIMIT 1').get();
  assert.equal(compressed.state,'completed');assert.ok(compressed.reserved_micros>=compressed.charged_micros,'visual-token expansion must be covered before dispatch');
  const usage=await bridge.usage('ses_chat_child');assert.equal(usage.requests.length,3);assert.ok(usage.chargedMicros>0);
  assert.equal(sql.prepare("SELECT SUM(reserved_micros) AS n FROM metered_requests WHERE state='reserved'").get().n,null);
  assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM upstream_leases WHERE state=\'active\'').get().n,0);
}finally{await bridge?.close();globalThis.fetch=realFetch;sql.close();}
console.log('Native PDF: Chat/Responses upload, capabilities, >1 MB transport, output limit, modern ancestry, authentication, settlement and rejection passed');
