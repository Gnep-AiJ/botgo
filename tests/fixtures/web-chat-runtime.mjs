import assert from 'node:assert/strict';
import fs from 'node:fs';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { encryptSecret } from '../../worker/src/platform-admin.js';
import { MODEL_SEEDS } from '../../worker/src/metering.js';
register(new URL('./web-chat-loader.mjs', import.meta.url), import.meta.url);
const { default: worker } = await import('../../worker/src/index.js');
const { onRequest } = await import('../../functions/api/[[path]].js');

export async function createWebChatRuntime({searchFixture=false,imagesFixture=false,upstreamKey='isolated-upstream-key'}={}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const migrations = new URL('../../worker/migrations/', import.meta.url);
  for (const name of fs.readdirSync(migrations).filter(n => n.endsWith('.sql')).sort()) db.exec(fs.readFileSync(new URL(name, migrations), 'utf8'));
  const env = {
    AUTH_SECRET: 'isolated-test-session-secret', QQ_SMTP_USER: 'sender@example.invalid', QQ_SMTP_AUTH_CODE: 'isolated-test-smtp',
    UPSTREAM_CONFIG_KEY: Buffer.alloc(32, 5).toString('base64url'),
    DB: {
      prepare(query) {
        let args = [];
        return {
          bind(...values) { args = values; return this; },
          async first() { return db.prepare(query).get(...args) || null; },
          async all() { return { results: db.prepare(query).all(...args) }; },
          runSync() { return { meta: { changes: Number(db.prepare(query).run(...args).changes) } }; },
          async run() { return this.runSync(); }
        };
      },
      async batch(items) {
        db.exec('BEGIN');
        // D1 batches are atomic; do not yield into a second SQLite BEGIN midway.
        try { const values = items.map(item=>item.runSync()); db.exec('COMMIT'); return values; }
        catch (error) { db.exec('ROLLBACK'); throw error; }
      }
    }
  };
  db.exec("INSERT INTO accounts(id,email,password_hash,credit_balance) VALUES('fixture-a','a@example.invalid','unused',10000),('fixture-b','b@example.invalid','unused',10000)");
  const secret = await encryptSecret(upstreamKey, env);
  const media=new Map();
  if(imagesFixture){
    env.DESKTOP_RELEASES={async put(key,value){media.set(key,new Uint8Array(value));return {key};},async get(key){const bytes=media.get(key);return bytes?{size:bytes.length,async arrayBuffer(){return bytes.slice().buffer;}}:null;},async delete(key){media.delete(key);}};
  }
  const baseUrl=searchFixture?'https://kedaya.ai/v1':'https://upstream.invalid/v1';
  db.prepare('INSERT INTO upstream_profiles(id,name,base_url,api_key_ciphertext,api_key_iv,key_hint) VALUES(?,?,?,?,?,?)').run('fixture-p', 'fixture', baseUrl, secret.ciphertext, secret.iv, 'fixture');
  if(imagesFixture){db.prepare("INSERT INTO image_model_routes(model_id,name,profile_id,upstream_model_id,billing_model_id,price_json,enabled,verified_at) VALUES('gpt-image-2.5-sunburst','Sunburst','fixture-p','gpt-image-2.5-sunburst','gpt-image-2.5-sunburst',?,1,CURRENT_TIMESTAMP)").run(JSON.stringify({textInput:5,textCached:1.25,imageInput:8,imageCached:2,imageOutput:30}));db.exec("UPDATE metering_settings SET default_image_model='gpt-image-2.5-sunburst'");}
  const models = searchFixture?[MODEL_SEEDS[0],{...MODEL_SEEDS[1],id:'gpt-6.1-sol',name:'GPT-6.1 Sol'}]:MODEL_SEEDS.slice(0, 2);
  for (const [i, model] of models.entries()) {
    db.prepare('INSERT INTO model_catalog(id,name,upstream_id,price_json,enabled,agent_enabled,web_enabled) VALUES(?,?,?,?,1,1,0)').run(model.id, model.name, model.id, JSON.stringify(model.price));
    db.prepare('INSERT INTO agent_model_routes(model_id,profile_id,protocol,enabled,verified_at) VALUES(?,?,?,1,CURRENT_TIMESTAMP)').run(model.id, 'fixture-p', i ? 'responses' : 'chat');
    db.prepare('INSERT INTO agent_route_members(model_id,profile_id,upstream_model_id,enabled,verified_at) VALUES(?,?,?,1,CURRENT_TIMESTAMP)').run(model.id, 'fixture-p', searchFixture?model.id:'fixture-vendor-' + i);
  }
  const codes = new Map(), upstreamCalls = [], jobs = [];let upstreamMode='normal';
  const originalFetch = globalThis.fetch, originalSocket = globalThis.__botgoTestSocketConnect;
  globalThis.__botgoTestSocketConnect = (address, options) => {
    assert.deepEqual(address, { hostname: 'smtp.qq.com', port: 465 });
    assert.equal(options.secureTransport, 'on');
    let reader, authStep = 0, recipient, closed = false;
    const reply = value => reader.enqueue(new TextEncoder().encode(value + '\r\n'));
    return {
      readable: new ReadableStream({ start(controller) { reader = controller; reply('220 fixture SMTP'); } }),
      writable: new WritableStream({ write(bytes) {
        const command = new TextDecoder().decode(bytes).trim();
        if (command.startsWith('EHLO')) reply('250 fixture');
        else if (command === 'AUTH LOGIN') { authStep = 1; reply('334 fixture'); }
        else if (authStep === 1) { authStep = 2; reply('334 fixture'); }
        else if (authStep === 2) { authStep = 0; reply('235 fixture'); }
        else if (command.startsWith('MAIL FROM:')) reply('250 fixture');
        else if (command.startsWith('RCPT TO:')) { recipient = command.slice(9, -1); reply('250 fixture'); }
        else if (command === 'DATA') reply('354 fixture');
        else if (command.startsWith('From:')) {
          const body = Buffer.from(command.split('\r\n\r\n')[1].replace(/\r\n\.\s*$/, '').replaceAll('\r\n', ''), 'base64').toString('utf8');
          codes.set(recipient, body.match(/验证码：(\d{6})/)[1]); reply('250 fixture');
        } else if (command === 'QUIT') reply('221 fixture');
        else throw new Error('Unexpected SMTP fixture command');
      } }),
      close() { if (!closed) { reader.close(); closed = true; } }
    };
  };
  globalThis.fetch = async (url, init) => {
    assert.ok([baseUrl+'/chat/completions', baseUrl+'/responses',...(imagesFixture?[baseUrl+'/images/generations']:[])].includes(String(url)), 'upstream is intercepted; no external network access');
    const body = JSON.parse(init.body); upstreamCalls.push(body);
    if(upstreamMode==='reject')return Response.json({error:'isolated upstream unavailable'},{status:503});
    if(upstreamMode==='hold')await new Promise((resolve,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true}));
    if(upstreamMode==='slow')await new Promise(resolve=>setTimeout(resolve,600));
    if(String(url).endsWith('/images/generations'))return Response.json({data:[{b64_json:upstreamMode==='image-invalid'?'bad':'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVQIHWP4z8AAAAMBAQAY3Y2wAAAAAElFTkSuQmCC'}],...(upstreamMode==='image-no-usage'?{}:{usage:{input_tokens:17,input_tokens_details:{text_tokens:17,image_tokens:0},output_tokens:272,output_tokens_details:{image_tokens:272}}})});
    const imageTool=body.tools?.some(t=>(t.name||t.function?.name)==='generate_image'),prompt=(body.input||body.messages)?.at(-1)?.content||'';
    if(imageTool&&/画|生成图片|draw|generate an image/i.test(prompt)){
      const args=JSON.stringify({prompt,size:'1024x1024'}),call={type:'function_call',id:'fc_fixture',call_id:'call_fixture',name:'generate_image',arguments:args};
      if(String(url).endsWith('/responses')){
        const result={status:'completed',output:[call],usage:{input_tokens:100,output_tokens:10}};
        if(upstreamMode==='image-tool-json')return Response.json(result);
        return new Response([{type:'response.output_item.added',output_index:0,item:{...call,arguments:''}},{type:'response.function_call_arguments.delta',output_index:0,delta:args.slice(0,9)},{type:'response.function_call_arguments.delta',output_index:0,delta:args.slice(9)},{type:'response.output_item.done',output_index:0,item:call},{type:'response.completed',response:result}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
      }
      if(upstreamMode==='image-tool-json')return Response.json({choices:[{message:{tool_calls:[{id:'call_fixture',type:'function',function:{name:'generate_image',arguments:args}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:100,completion_tokens:10}});
      return new Response([{choices:[{delta:{tool_calls:[{index:0,id:'call_fixture',function:{name:'generate_image',arguments:args.slice(0,9)}}]}}]},{choices:[{delta:{tool_calls:[{index:0,function:{arguments:args.slice(9)}}]},finish_reason:'tool_calls'}]},{usage:{prompt_tokens:100,completion_tokens:10}}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
    }
    const text = '**本地联调回答**\n这是一条测试回答。';
    if(searchFixture&&body.tools?.[0]?.type==='web_search'){
      const result={status:'completed',output:[{type:'message',content:[{type:'output_text',text:'Cloudflare 官方文档说明兼容日期。',annotations:[{type:'url_citation',title:'Compatibility dates',url:'https://developers.cloudflare.com/workers/configuration/compatibility-dates/'},{type:'url_citation',title:'unsafe',url:'javascript:alert(1)'}]}]}],usage:{input_tokens:100,output_tokens:10},tool_usage:{web_search:{num_requests:upstreamMode==='search-none'?0:1}}};
      if(upstreamMode==='search-json')return Response.json(result);
      const events=[...(upstreamMode==='search-none'?[]:[{type:'response.web_search_call.searching'},{type:'response.web_search_call.completed'}]),{type:'response.output_text.delta',delta:result.output[0].content[0].text},{type:'response.completed',response:result}];
      return new Response(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
    }
    if (String(url).endsWith('/responses')) return Response.json({ output_text: text, usage: { input_tokens: 100, output_tokens: 10 } });
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: ${JSON.stringify({ usage: { prompt_tokens: 100, completion_tokens: 10 } })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  };
  const context = { waitUntil(promise) { jobs.push(promise); } };
  const workerFetch = request => worker.fetch(request, env, context);
  return {
    db, env, models, codes, upstreamCalls, workerFetch,media,
    setUpstreamMode(mode){assert.ok(['normal','reject','slow','hold','search-none','search-json','image-invalid','image-no-usage','image-tool-json'].includes(mode));upstreamMode=mode;},
    pagesFetch: request => onRequest({ request, env: { BOTGO_API: { fetch: workerFetch } } }),
    async settle() { while (jobs.length) await Promise.all(jobs.splice(0)); },
    close() { globalThis.fetch = originalFetch; globalThis.__botgoTestSocketConnect = originalSocket; db.close(); }
  };
}
