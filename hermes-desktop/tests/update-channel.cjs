const assert=require('node:assert/strict');
const {updateFetch}=require('../runtime/update-channel.cjs');
(async()=>{
  let payload={engine:'hermes',release:{engine:'hermes',version:'2.0.0-preview.2'}};
  const fetcher=updateFetch(async(_url,options)=>{assert.equal(options.headers.get('x-botgo-client-engine'),'hermes');assert.equal(options.headers.get('authorization'),'Bearer bgdt_fixture');return Response.json(payload);});
  const call=()=>fetcher('https://botgo.win/api/desktop/releases/current',{headers:{authorization:'Bearer bgdt_fixture'}});
  assert.equal((await(await call()).json()).release.engine,'hermes');
  payload={release:{version:'9.0.0'}};await assert.rejects(call,/Hermes/);
  payload={engine:'opencode',release:{engine:'opencode',version:'9.0.0'}};await assert.rejects(call,/Hermes/);
  payload={engine:'hermes',release:null};assert.equal((await(await call()).json()).release,null);
  console.log('Hermes update channel rejects legacy and other-engine installers');
})().catch(error=>{console.error(error);process.exitCode=1});
