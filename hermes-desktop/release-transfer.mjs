// Copies one already-signed installer to its immutable R2 key, then reads EVERY
// production byte back and hashes it before writing a receipt. Requires an
// existing published object as binding proof. No D1 or business Worker changes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.dirname(here);
const version=JSON.parse(fs.readFileSync(path.join(here,'upstream.json'))).version;
const file=path.join(root,'artifacts/releases/hermes-preview-polish',`BotGo-${version}-win-x64.exe`);
if(!/^2\.0\.0-preview\.\d+$/.test(version)||!fs.statSync(file).isFile())throw Error('Expected a pinned Hermes preview installer');
const digest=async stream=>{const hash=crypto.createHash('sha256');let size=0;for await(const chunk of stream){hash.update(chunk);size+=chunk.length;}return {sha256:hash.digest('hex'),size};};
const expected=await digest(fs.createReadStream(file));
if(expected.size>1024**3)throw Error('Installer exceeds the current signed updater limit');
const key=`hermes/${version}/${expected.sha256}.exe`,token=crypto.randomBytes(32).toString('hex');
const runCli=(args,input)=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',reject);child.once('exit',code=>code===0?resolve(output):reject(Error('Release CLI failed: '+output.replaceAll(token,'[redacted]'))));child.stdin.end(input||'');});
async function edgeWorker(){
 const name='botgo-transfer-'+crypto.randomBytes(6).toString('hex');
 const configPath=path.join(root,'artifacts/verification/hermes-capabilities-20261023',name+'.json');
 fs.writeFileSync(configPath,JSON.stringify({name,account_id:'e34685eb42587931743b7aae6b38921e',main:path.join(here,'release-transfer-worker.mjs'),compatibility_date:'2026-10-24',workers_dev:true,r2_buckets:[{binding:'RELEASES',bucket_name:'botgo-desktop-releases'}],vars:{OBJECT_KEY:key,SHA256:expected.sha256,PROOF_KEY:'desktop/1.3.9/BotGo-1.3.9-win-x64.exe',REMOTE_PREVIEW:'1',EXPIRES_AT:String(Date.now()+45*60*1000)}}));
 const stop=async()=>{await runCli(['delete',name,'--config',configPath,'--force']);console.log('Temporary transfer Worker removed');};
 try{const deployed=await runCli(['deploy','--config',configPath]);const url=deployed.match(new RegExp('https://'+name+'\\.[a-z0-9-]+\\.workers\\.dev'))?.[0];if(!url)throw Error('Temporary Worker URL missing');await runCli(['secret','put','TRANSFER_TOKEN','--config',configPath],token+'\n');return {url,stop};}catch(error){await stop().catch(()=>{});throw error;}
}
const worker=await edgeWorker();
let uploadId,complete=false;
const request=async(route,init={})=>{const response=await fetch(`${worker.url}${route}`,{...init,
  headers:{authorization:'Bearer '+token,...init.headers},signal:AbortSignal.timeout(15*60*1000)});if(!response.ok){const detail=(await response.text()).slice(0,3000).replaceAll(token,'[redacted]');throw Error(`R2 transfer ${route.split('?')[0]} returned ${response.status}: ${detail}`);}return response;};
try{
  const proof=await(await request('/production-proof')).json();
  if(proof?.key!=='desktop/1.3.9/BotGo-1.3.9-win-x64.exe'||proof.size!==124223432)throw Error('Production R2 binding proof failed; refusing upload');
  console.log('Production R2 binding verified against published legacy object');
  const existing=await(await request('/head')).json();
  if(!existing){
    uploadId=(await(await request('/start',{method:'POST'})).json()).uploadId;
    const parts=[];let part=0;
    for await(const chunk of fs.createReadStream(file,{highWaterMark:16*1024*1024})){
      const response=await request(`/part?uploadId=${encodeURIComponent(uploadId)}&part=${++part}`,{method:'PUT',headers:{'content-length':String(chunk.length)},body:chunk});
      parts.push(await response.json());console.log(`Uploaded release part ${part}`);
    }
    console.log('Completing immutable multipart object');
    await request('/complete?uploadId='+encodeURIComponent(uploadId),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(parts)});complete=true;
    console.log('Immutable object complete; beginning full range readback');
  }else if(existing.size!==expected.size||existing.sha256!==expected.sha256)throw Error('Immutable release key already has different metadata');
  // Bound remote-binding proxy buffers to 16 MiB, retaining a hash over EVERY
  // byte in original order. A whole-object binding response can buffer 500+ MiB.
  const readback=crypto.createHash('sha256');let bytes=0;
  const block=16*1024*1024;
  for(let offset=0;offset<expected.size;offset+=4*block){
    const chunks=await Promise.all(Array.from({length:Math.min(4,Math.ceil((expected.size-offset)/block))},async(_,index)=>{
      const start=offset+index*block,length=Math.min(block,expected.size-start);
      const chunk=Buffer.from(await(await request(`/object?offset=${start}&length=${length}`)).arrayBuffer());
      if(chunk.length!==length)throw Error('Remote range length mismatch');return chunk;
    }));
    for(const chunk of chunks){readback.update(chunk);bytes+=chunk.length;}
    console.log(`Verified remote bytes ${bytes}/${expected.size}`);
  }
  const remote={size:bytes,sha256:readback.digest('hex')};
  if(remote.size!==expected.size||remote.sha256!==expected.sha256)throw Error('Full remote readback size/hash mismatch');
  const receipt={version,file,objectKey:key,...remote,verifiedAt:new Date().toISOString(),fullRemoteReadback:true,productionBindingProof:proof,published:false};
  fs.writeFileSync(path.join(root,'artifacts/verification/hermes-capabilities-20261023/transfer-receipt.json'),JSON.stringify(receipt,null,2));
  console.log('Installer uploaded and fully verified: '+JSON.stringify({version,...remote}));
}finally{if(uploadId&&!complete)await request('/abort?uploadId='+encodeURIComponent(uploadId),{method:'DELETE'}).catch(()=>{});await worker.stop();}
