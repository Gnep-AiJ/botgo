const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createCodexRunner } = require('../lib/codex-runner.cjs');
const { runtimeEnvironment } = require('../lib/native.cjs');

test('shared desktop runner preserves long Unicode output and the final non-newline event', async () => {
  const child = new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};
  const runner = createCodexRunner({ command:'bundled-codex', spawnImpl:()=>child });
  const events=[];
  const task=runner.start({projectPath:process.cwd(),prompt:'inspect',permission:'read-only',codexHome:process.cwd(),relayKey:'bgk_test',onEvent:e=>events.push(e)});
  const answer='完整结果'.repeat(16000);
  const bytes=Buffer.from(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:answer}}));
  for(let i=0;i<bytes.length;i+=103)child.stdout.emit('data',bytes.subarray(i,i+103));
  child.emit('close',0);
  await task.promise;
  assert.equal(events.find(e=>e.type==='progress').message,answer);
  assert.equal(events.at(-1).type,'completed');
});

test('failed process surfaces diagnostics with credentials removed', async()=>{
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();
  const task=createCodexRunner({command:'bundled',spawnImpl:()=>child}).start({projectPath:process.cwd(),prompt:'inspect',permission:'read-only',codexHome:process.cwd(),relayKey:'bgk_test'});
  child.stderr.emit('data','Network failure Bearer bgk_private');child.emit('close',1);
  const result=await task.promise;assert.match(result.events.at(-1).message,/Network failure/);assert.doesNotMatch(JSON.stringify(result.events),/bgk_private/);
});

test('Windows cancellation kills only the active process tree',async()=>{
 const child=new EventEmitter();child.pid=1234;child.stdout=new EventEmitter();child.stderr=new EventEmitter();const calls=[];
 const task=createCodexRunner({command:'bundled',platform:'win32',spawnImpl:(command,args)=>{calls.push({command,args});return calls.length===1?child:new EventEmitter()}}).start({projectPath:process.cwd(),prompt:'inspect',permission:'read-only',codexHome:process.cwd(),relayKey:'bgk_test'});
 task.stop();assert.deepEqual(calls[1].args,['/PID','1234','/T','/F']);child.emit('close',1);assert.equal((await task.promise).events.at(-1).type,'stopped');
});

test('runtime removes case-insensitive inherited provider overrides',()=>{
 const env=runtimeEnvironment(process.cwd(),'bgk_test',{openai_api_key:'other',Codex_Home:'other',PATH:'keep'});
 assert.equal(env.openai_api_key,undefined);assert.equal(env.Codex_Home,undefined);assert.equal(env.PATH,'keep');
});
