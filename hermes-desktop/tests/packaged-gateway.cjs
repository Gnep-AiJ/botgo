const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFile}=require('node:child_process');const {promisify}=require('node:util');const exec=promisify(execFile);
const root=path.resolve(__dirname,'../..'),payload=path.join(root,process.argv.includes('--installed')?'artifacts/verification/botgo-installed-v5/resources/hermes-payload':'artifacts/releases/hermes-preview-polish/win-unpacked/resources/hermes-payload');
const runtime=JSON.parse(fs.readFileSync(path.join(payload,'runtime.json'),'utf8'));
const python=path.join(payload,runtime.python),source=path.join(payload,'hermes-agent');
const home=path.join(root,'artifacts/verification/hermes-packaged-gateway',String(Date.now()));fs.mkdirSync(home,{recursive:true});
const env={...process.env,HERMES_HOME:home,HERMES_RUNTIME_DIR:path.join(payload,'tools'),PYTHONPATH:[source,path.join(payload,'venv/Lib/site-packages')].join(path.delimiter),PYTHONNOUSERSITE:'1'};
const run=async args=>(await exec(python,['-m','hermes_cli.main',...args],{cwd:source,env,windowsHide:true,timeout:90000,maxBuffer:1024*1024})).stdout;
(async()=>{
 try{
  const activate=await exec(python,['-c','import hermes_bootstrap; from pathlib import Path; from pm.environments import committed_venv; import sys; assert committed_venv(Path.cwd()) == Path.cwd().parent / "venv"; import gateway.run; print("SEALED_ENV_OK")'],{cwd:source,env,windowsHide:true,timeout:30000});
  assert.match(activate.stdout,/SEALED_ENV_OK/);
  const first=JSON.parse(await run(['gateway','ensure','--json']));assert.equal(first.state,'ready');
  const second=JSON.parse(await run(['gateway','ensure','--json']));assert.equal(second.endpoint.instance_id,first.endpoint.instance_id);
  await run(['gateway','restart','--detach']);
  const after=JSON.parse(await run(['gateway','ensure','--json']));assert.equal(after.state,'ready');assert.notEqual(after.endpoint.instance_id,first.endpoint.instance_id);
  fs.writeFileSync(path.join(home,'result.json'),JSON.stringify({passed:true,checks:['sealed-env','cold-start','idempotent-ensure','detached-restart'],paidCalls:0},null,2));
  console.log('Packaged canonical gateway cold start and restart passed: '+home);
 }finally{await run(['gateway','stop']).catch(()=>{});}
})().catch(error=>{fs.writeFileSync(path.join(home,'failure.txt'),String(error.stack||error));console.error(error.message);process.exitCode=1});
