// Explicit, bounded upstream capability check. Reads a temporary process secret;
// prints only model/status/usage, never headers, response bodies or credentials.
import {usageObserver,MODEL_SEEDS} from '../worker/src/metering.js';
const base=process.env.BOTGO_PROBE_ORIGIN;
const key=process.env.BOTGO_PROBE_KEY;
if(!base?.startsWith('https://')||!key)throw Error('Set BOTGO_PROBE_ORIGIN and BOTGO_PROBE_KEY for this process.');
async function call(endpoint,body){
 const response=await fetch(`${base.replace(/\/$/,'')}/${endpoint}`,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000),redirect:'error'});
 if(!response.ok){await response.body?.cancel();return {status:response.status};}
 if(!response.headers.get('content-type')?.includes('text/event-stream')){await response.body?.cancel();return {status:response.status,error:'not_sse'};}
 const observer=usageObserver(),decoder=new TextDecoder(),reader=response.body.getReader();let bytes=0,text='';
 for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>1024*1024){await reader.cancel();throw Error('size_limit');}observer.push(value);text+=decoder.decode(value,{stream:true});}
 const events=text.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>{try{return JSON.parse(l.slice(5));}catch{return null;}});
 return {status:response.status,usage:observer.finish(),output:events.find(e=>e?.type==='response.completed')?.response?.output||[]};
}
for(const model of MODEL_SEEDS){
 const record={model:model.id};
 try{
  const web=await call('chat/completions',{model:model.id,messages:[{role:'user',content:'Reply only OK'}],max_completion_tokens:32,stream:true,stream_options:{include_usage:true}});record.web={status:web.status,usage:!!web.usage};
  const tools=[{type:'function',name:'botgo_probe',parameters:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false},strict:true}];
  const input=[{role:'user',content:'Call botgo_probe with value OK. After the result, reply only OK.'}];
  const agent=await call('responses',{model:model.id,input,tools,tool_choice:{type:'function',name:'botgo_probe'},max_output_tokens:128,stream:true});
  const tool=agent.output?.find(i=>i.type==='function_call'&&i.name==='botgo_probe');
  record.agent={status:agent.status,usage:!!agent.usage,tool:!!tool};
  if(tool){const resumed=await call('responses',{model:model.id,input:[...input,...agent.output,{type:'function_call_output',call_id:tool.call_id,output:'OK'}],max_output_tokens:64,stream:true});record.resume={status:resumed.status,usage:!!resumed.usage};}
 }catch(e){record.error=e.name==='TimeoutError'?'timeout':'request_failed';}
 console.log(JSON.stringify(record));
}
