const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
const source=path.join(root,'artifacts/hermes');
const payload=process.argv.includes('--packaged')?path.join(root,'artifacts/releases/hermes-preview-polish/win-unpacked/resources/hermes-payload'):null;
const runtime=payload?JSON.parse(fs.readFileSync(path.join(payload,'runtime.json'),'utf8')):null;
const {createGateway,taskId}=require(path.join(source,'apps/desktop/electron/botgo/gateway.cjs'));
const {managedConfig,writeManagedConfig}=require(path.join(source,'apps/desktop/electron/botgo/config.cjs'));
async function nativeAgent(gateway,token,home){
  const fixture=path.join(home,'fixture.txt');fs.writeFileSync(fixture,'BOTGO_NATIVE_'+crypto.randomBytes(8).toString('hex'));
  const config=writeManagedConfig(home,gateway);config.model.streaming=false;fs.writeFileSync(path.join(home,'config.yaml'),JSON.stringify(config));
  const code=`import os\nfrom run_agent import AIAgent\na=AIAgent(model='fixture-chat',provider='botgo-chat',api_key=os.environ['BOTGO_HERMES_API_KEY'],base_url=os.environ['BOTGO_FIXTURE_URL'],api_mode='chat_completions',enabled_toolsets=['file'],session_id='native-fixture',quiet_mode=True,skip_context_files=True,skip_memory=True,skip_background_review=True,max_iterations=5,cwd=os.environ['BOTGO_FIXTURE_HOME'])\nr=a.run_conversation('Read fixture.txt using read_file, then report the contents.')\nassert 'BOTGO_NATIVE_' in r['final_response'], r['final_response']\nprint('NATIVE_TOOL_LOOP_PASSED')`;
  return new Promise((resolve,reject)=>{
    const imageCode="\nimport json\nfrom pathlib import Path\nfrom tools.image_generation_tool import check_image_generation_requirements, _handle_image_generate\nassert check_image_generation_requirements()\nr=json.loads(_handle_image_generate({'prompt':'test image','aspect_ratio':'square'}))\nassert r.get('success'), r\nassert Path(r['image']).is_file()\nprint('NATIVE_IMAGE_TOOL_PASSED')\nb=AIAgent(model='fixture-chat',provider='botgo-chat',api_key=os.environ['BOTGO_HERMES_API_KEY'],base_url=os.environ['BOTGO_FIXTURE_URL'],api_mode='chat_completions',enabled_toolsets=['terminal'],session_id='native-terminal-fixture',quiet_mode=True,skip_context_files=True,skip_memory=True,skip_background_review=True,max_iterations=3,cwd=os.environ['BOTGO_FIXTURE_HOME'])\nshell=b.run_conversation('Run local terminal probe and report the command output.')\nassert b'BOTGO_LOCAL_TASK_OK' in (Path(os.environ['BOTGO_FIXTURE_HOME']) / 'botgo-terminal-result.txt').read_bytes().replace(bytes([0]), b'')\nprint('NATIVE_TERMINAL_TOOL_PASSED')\n";
    const child=spawn(payload?path.join(payload,runtime.python):path.join(root,'artifacts/hermes-python/Scripts/python.exe'),['-c',code+imageCode],{cwd:payload?path.join(payload,'hermes-agent'):source,windowsHide:true,
      env:{...process.env,...(payload?{PYTHONPATH:[path.join(payload,'hermes-agent'),path.join(payload,'venv/Lib/site-packages')].join(path.delimiter),PYTHONNOUSERSITE:'1'}:{}),HERMES_HOME:home,HERMES_RUNTIME_DIR:payload?path.join(payload,'tools'):path.join(root,'artifacts/hermes-tools'),BOTGO_HERMES_API_KEY:token,BOTGO_FIXTURE_URL:config.model.base_url,BOTGO_FIXTURE_HOME:home,HTTP_PROXY:'',HTTPS_PROXY:'',NO_PROXY:'127.0.0.1,localhost'}});
    let output='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v);
    const timeout=setTimeout(()=>{child.kill();reject(Error('Native tool loop timed out: '+output.slice(-3000)));},payload?360000:120000);
    child.on('error',reject);child.on('exit',code=>{clearTimeout(timeout);if(code!==0)reject(Error(output.slice(-5000)));else{assert.match(output,/NATIVE_TOOL_LOOP_PASSED/);resolve();}});
  });
}
(async()=>{
  const home=path.join(root,'artifacts/verification/hermes-tests/'+Date.now());fs.mkdirSync(home,{recursive:true});
  const token='a'.repeat(64);const calls=[];let failure=0;
  const session={key:'bgk_fixture',defaultModel:'fixture-chat',imageModels:[{id:'fixture-image',billingModelId:'fixture-image'}],account:{email:'hermes@example.invalid',balanceMicros:1000000},models:[
    {id:'fixture-chat',name:'Fixture',protocol:'chat',price:{input:1,cached:0,write:0,output:1},multiplier:1,limit:{context:128000,output:8192}},
    {id:'fixture-responses',protocol:'responses',price:{input:1,cached:0,write:0,output:1},multiplier:1,limit:{context:128000,output:8192}}]};
  const cloud=http.createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/api/desktop/opencode/session')return res.end(JSON.stringify(session));
    if(req.url.startsWith('/api/opencode/usage'))return res.end(JSON.stringify({taskId:new URL(req.url,'http://local').searchParams.get('taskId'),chargedMicros:9}));
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));calls.push({headers:req.headers,body,url:req.url});
    if(failure){res.writeHead(failure);return res.end(JSON.stringify({code:'BALANCE_INSUFFICIENT'}));}
    if(req.url==='/api/opencode/v1/images/generations')return res.end(JSON.stringify({data:[{b64_json:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='}]}));
    if(body.messages?.some(m=>m.content?.includes?.('Run local terminal probe'))){
      const tool=body.messages.findLast(m=>m.role==='tool');
      const message=tool?{role:'assistant',content:tool.content}:{role:'assistant',content:null,tool_calls:[{id:'call_terminal',type:'function',function:{name:'terminal',arguments:JSON.stringify({command:'echo BOTGO_LOCAL_TASK_OK > \"'+path.join(home,'botgo-terminal-result.txt').replaceAll('\\','/')+'\"',timeout:10})}}]};
      return res.end(JSON.stringify({id:'chatcmpl-terminal',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message,finish_reason:tool?'stop':'tool_calls'}],usage:{prompt_tokens:15,completion_tokens:8,total_tokens:23}}));
    }
    if(body.messages?.some(m=>m.content?.includes?.('Read fixture.txt'))){
      const tool=body.messages.findLast(m=>m.role==='tool');
      const message=tool?{role:'assistant',content:tool.content}:{role:'assistant',content:null,tool_calls:[{id:'call_fixture',type:'function',function:{name:'read_file',arguments:JSON.stringify({path:path.join(home,'fixture.txt')})}}]};
      return res.end(JSON.stringify({id:'chatcmpl-fixture',object:'chat.completion',created:1,model:body.model,choices:[{index:0,message,finish_reason:tool?'stop':'tool_calls'}],usage:{prompt_tokens:15,completion_tokens:8,total_tokens:23}}));
    }
    res.end(JSON.stringify({ok:true}));
  });
  await new Promise(resolve=>cloud.listen(0,'127.0.0.1',resolve));let gateway;
  try{
    gateway=await createGateway({origin:`http://127.0.0.1:${cloud.address().port}`,deviceToken:'bgdt_fixture',token});
    const send=(body,headers={},endpoint='/chat/completions')=>fetch(gateway.baseURL+endpoint,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','x-session-id':'session/opaque:1',...headers},body:JSON.stringify(body)});
    assert.equal((await send({model:'fixture-chat'},{authorization:'bad'})).status,401);
    assert.equal((await send({model:'fixture-chat'},{origin:'https://evil.invalid'})).status,401);
    assert.equal((await send({model:'foreign'})).status,403);
    assert.equal((await send({model:'fixture-chat'}, {}, '/responses')).status,403);
    assert.equal((await send({model:'fixture-chat',messages:[]})).status,200);
    assert.equal(calls.at(-1).headers['x-botgo-task-id'],taskId('session/opaque:1'));
    assert.equal((await send({model:'fixture-responses',input:'test'}, {}, '/responses')).status,200);
    const image='data:image/png;base64,iVBORw0KGgo=';
    await send({model:'fixture-chat',messages:[{role:'user',content:[{type:'text',text:'Synthetic image transport check'},{type:'image_url',image_url:{url:image}}]}]});
    assert.equal(calls.at(-1).body.messages[0].content[1].image_url.url,image,'Chat image payload must survive both local bridges');
    await send({model:'fixture-responses',input:[{role:'user',content:[{type:'input_text',text:'Synthetic image transport check'},{type:'input_image',image_url:image}]}]}, {}, '/responses');
    assert.equal(calls.at(-1).body.input[0].content[1].image_url,image,'Responses image payload must survive both local bridges');
    failure=402;const count=calls.length;assert.equal((await send({model:'fixture-chat',messages:[]})).status,402);assert.equal(calls.length,count+1);failure=0;
    assert.equal((await gateway.usage('session/opaque:1')).chargedMicros,9);
    const catalog=await(await fetch(gateway.baseURL+'/models',{headers:{authorization:'Bearer '+token}})).json();assert.equal(catalog.data.length,2);assert.ok(!JSON.stringify(catalog).includes(session.key));
    const old={model:{default:'fixture-chat'},memory:{enabled:true},mcp_servers:{demo:{command:'demo'}},terminal:{timeout:42},gateway:{platforms:{weixin:{enabled:true}}},skills:{enabled:['example']}};
    const managed=managedConfig(old,gateway);for(const key of ['memory','mcp_servers','terminal','gateway','skills'])assert.deepEqual(managed[key],old[key]);assert.ok(!JSON.stringify(managed).includes(token));assert.equal(managed.providers['botgo-chat'].session_affinity_header,'x-session-id');
    assert.equal(managed.tts.provider,'botgo-windows');
    assert.equal(managedConfig({...old,tts:{provider:'edge'}},gateway).tts.provider,'botgo-windows');
    assert.deepEqual(managedConfig({...old,tts:{provider:'elevenlabs',voice:'custom'}},gateway).tts,{provider:'elevenlabs',voice:'custom'});
    await nativeAgent(gateway,token,home);
    const native=calls.filter(c=>c.body.messages?.some(m=>m.role==='tool'));
    assert.ok(native.length>0,'Hermes must execute an actual file tool');
    fs.writeFileSync(path.join(home,'result.json'),JSON.stringify({passed:true,checks:['auth','origin','catalog','protocols','billing-identity','402-no-replay','usage','native-config-preservation','Hermes-native-file-tool-loop']},null,2));
    console.log('BotGo Hermes gateway and native tool loop passed: '+home);
  }finally{await gateway?.close();cloud.closeAllConnections();await new Promise(resolve=>cloud.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
