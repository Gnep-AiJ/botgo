import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import worker from '../release-transfer-worker.mjs';
// Workerd provides this extension; Node is only the test host.
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
const calls=[];
const env={TRANSFER_TOKEN:'fixture',SHA256:'a'.repeat(64),OBJECT_KEY:'hermes/2.0.0-preview.4/'+ 'a'.repeat(64)+'.exe',
  RELEASES:{head:async key=>{calls.push(key);return {size:12,customMetadata:{sha256:'a'.repeat(64)}};},
    get:async(key,options)=>{calls.push(key);assert.deepEqual(options,{range:{offset:4,length:4}});return {size:12,body:new Uint8Array([4,5,6,7])};},
    resumeMultipartUpload:(key,id)=>{calls.push(key);return {};}}};
const request=(route,options={})=>worker.fetch(new Request('http://127.0.0.1'+route,{headers:{authorization:'Bearer fixture',...options.headers},...options}),env);
assert.equal((await worker.fetch(new Request('http://127.0.0.1/head'),{...env,TRANSFER_TOKEN:undefined})).status,503);
assert.equal((await worker.fetch(new Request('http://127.0.0.1/head'),{...env,EXPIRES_AT:'1'})).status,410);
assert.equal((await request('/head',{headers:{authorization:'wrong'}})).status,401);
assert.equal(calls.length,0);
assert.equal((await request('/head',{headers:{authorization:'Bearer fixture',origin:'https://foreign.invalid'}})).status,401);
assert.equal((await request('/start',{method:'POST'})).status,409,'existing immutable release object is not overwritten');
assert.equal((await request('/part?uploadId=test&part=0',{method:'PUT',headers:{authorization:'Bearer fixture','content-length':'0'}})).status,400);
assert.equal((await request('/object?offset=-1&length=4')).status,400);
assert.equal((await request('/object?offset=0&length=20000000')).status,400);
assert.deepEqual(new Uint8Array(await(await request('/object?offset=4&length=4')).arrayBuffer()),new Uint8Array([4,5,6,7]));
assert.ok(calls.every(key=>key===env.OBJECT_KEY),'only the pinned release key can be accessed');
assert.equal((await request('/production-proof')).status,400,'proof cannot read an arbitrary key');
env.PROOF_KEY='desktop/1.3.9/BotGo-1.3.9-win-x64.exe';
env.RELEASES.head=async key=>{assert.equal(key,env.PROOF_KEY);return {key,size:124223432};};
assert.deepEqual(await(await request('/production-proof')).json(),{key:env.PROOF_KEY,size:124223432});
env.REMOTE_PREVIEW='1';
assert.equal((await worker.fetch(new Request('https://preview.workers.dev/head',{headers:{authorization:'Bearer wrong'}}),env)).status,401);
assert.equal((await worker.fetch(new Request('https://preview.workers.dev/head',{headers:{authorization:'Bearer fixture',origin:'https://foreign.invalid'}}),env)).status,401);
env.OBJECT_KEY='current/production.exe';assert.equal((await request('/head')).status,400);
console.log('Local release transfer capability, origin, exact-key and no-overwrite checks passed');
