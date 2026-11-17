// Server-owned native tool. The browser never supplies tool definitions or arguments.
export const IMAGE_TOOL={name:'generate_image',description:'Generate one new image when the user asks you to draw, create or illustrate an image. Decide from the conversation, not keywords alone. Do not use for greetings, explanations, image analysis or medical diagnosis. Incorporate the user requirements and relevant context in the prompt. This tool returns the finished image directly to the user; no further call is needed. Existing image editing is not supported.',parameters:{type:'object',properties:{prompt:{type:'string',description:'Complete description of the requested new image, up to 8192 characters.'},size:{type:'string',enum:['1024x1024','1536x1024','1024x1536']}},required:['prompt','size'],additionalProperties:false},strict:true};

export async function selectionRequestId(requestId){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('web-image-selection:'+requestId));
 return Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}

// A tool-only response is a valid metered model result, but not a finished user turn.
// Collect both native protocols; execute only one complete, validated tool call.
export function imageToolHistory(history){
 let buffer='',completed=false;const decoder=new TextDecoder(),calls=new Map();
 function result(item){
  const tools=item.choices?.[0]?.message?.tool_calls||item.output?.filter(o=>o.type==='function_call');
  if(tools?.length){calls.clear();tools.forEach((t,i)=>calls.set(String(i),{name:t.function?.name||t.name,arguments:t.function?.arguments??t.arguments}));}
 }
 function event(item){
  for(const t of item.choices?.[0]?.delta?.tool_calls||[]){const key=String(t.index??0),call=calls.get(key)||{name:'',arguments:''};if(t.function?.name)call.name+=t.function.name;if(t.function?.arguments)call.arguments+=t.function.arguments;calls.set(key,call);}
  if(['response.output_item.added','response.output_item.done'].includes(item.type)&&item.item?.type==='function_call'){
   const key=String(item.output_index??item.item.id),old=calls.get(key);calls.set(key,{name:item.item.name||old?.name||'',arguments:item.item.arguments||old?.arguments||''});
  }
  if(item.type==='response.function_call_arguments.delta'){const key=String(item.output_index??item.item_id),call=calls.get(key)||{name:'',arguments:''};call.arguments+=item.delta||'';calls.set(key,call);}
  if(item.type==='response.completed')result(item.response||{});
  for(const call of calls.values())if(typeof call.arguments!=='string'||call.arguments.length>32768)throw Error('INVALID_IMAGE_TOOL');
 }
 function line(value){if(!value.startsWith('data:'))return;const data=value.slice(5).trim();if(data&&data!=='[DONE]')event(JSON.parse(data));}
 function selected(){
  if(!calls.size)return null;
  if(calls.size!==1)throw Error('INVALID_IMAGE_TOOL');
  const call=[...calls.values()][0];if(call.name!=='generate_image')throw Error('INVALID_IMAGE_TOOL');
  const args=JSON.parse(call.arguments);
  if(!args||typeof args.prompt!=='string'||!args.prompt.trim()||args.prompt.length>8192||!['1024x1024','1536x1024','1024x1536'].includes(args.size)||Object.keys(args).some(k=>!['prompt','size'].includes(k)))throw Error('INVALID_IMAGE_TOOL');
  return {prompt:args.prompt.trim(),size:args.size,quality:'medium'};
 }
 return {
  done:()=>completed,
  selected:()=>completed?selected():null,
  history:{
   cancelled:history.cancelled,
   hasAnswer:()=>calls.size?!!selected():history.hasAnswer(),
   validateResult(value){result(value);return calls.size?!!selected():history.validateResult(value);},
   async push(bytes){buffer+=decoder.decode(bytes,{stream:true});let at;while((at=buffer.indexOf('\n'))>=0){line(buffer.slice(0,at).replace(/\r$/,''));buffer=buffer.slice(at+1);}if(buffer.length>2*1024*1024)throw Error('SSE_FRAME_TOO_LARGE');await history.push(bytes);},
   async finish(state){if(state==='completed'&&calls.size){selected();completed=true;return;}await history.finish(state);completed=state==='completed';},
   async result(value){if(calls.size){selected();completed=true;return;}await history.result(value);completed=true;}
  }
 };
}
