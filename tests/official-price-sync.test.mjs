import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseOpenAIModelMarkdown, parseClaudeModelMarkdown, parseGrokModelMarkdown, fetchClaudeModel, fetchGrokModel, supportsOfficialSync, verifiedOfficialModel, refreshCachedOfficialPrices, syncActiveOfficialPrices, PRICE_AI_MODEL } from '../worker/src/official-price-sync.js';
import { costMicros } from '../worker/src/metering.js';

const textDoc = `# GPT-6 Test

Model ID: \`gpt-6-test\`

## Model details

- Input modalities: text, image
- Output modalities: text
- 1,050,000 context window
- 128,000 max output tokens
- Reasoning token support

## Pricing

### Text tokens

| Metric | Price | Unit |
| --- | ---: | --- |
| Input | $2 | 1M tokens |
| Cached input | $0.2 | 1M tokens |
| Cache writes | $2.5 | 1M tokens |
| Output | $10 | 1M tokens |

- Prompts with more than 272K input tokens are priced at 2x input and cache rates and 1.5x output for the full request.

## Endpoints

| Endpoint | Route | Support |
| --- | --- | --- |
| Responses | \`v1/responses\` | Supported |
`;
const imageDoc = `# GPT-Image-3

Model ID: \`gpt-image-3\`

## Model details

- Input modalities: text, image
- Output modalities: image

## Pricing

### Text tokens

| Metric | Price | Unit |
| --- | ---: | --- |
| Input | $5 | 1M tokens |
| Cached input | $1.25 | 1M tokens |

### Image tokens

| Metric | Price | Unit |
| --- | ---: | --- |
| Input | $8 | 1M tokens |
| Cached input | $2 | 1M tokens |
| Output | $30 | 1M tokens |

## Endpoints

| Endpoint | Route | Support |
| --- | --- | --- |
| Image generation | \`v1/images/generations\` | Supported |
`;

assert.equal(parseOpenAIModelMarkdown(textDoc, 'gpt-6-test').price.output, 10);
assert.deepEqual(parseOpenAIModelMarkdown(textDoc, 'gpt-6-test').limit, {context:1050000,output:128000});
assert.equal(parseOpenAIModelMarkdown(imageDoc, 'gpt-image-3').imagePrice.imageOutput, 30);
assert.equal(parseOpenAIModelMarkdown(textDoc, 'gpt-6-other'), null, 'a different official ID cannot inherit a price');
assert.equal(parseOpenAIModelMarkdown(textDoc.replace('| Cache writes | $2.5 | 1M tokens |', ''), 'gpt-6-test'), null, 'incomplete prices cannot be imported');
assert.equal(parseOpenAIModelMarkdown(textDoc.replace('- Output modalities: text', '- Output modalities: text, image'), 'gpt-6-test'), null, 'unpriced output modalities cannot be imported');

const db = new DatabaseSync(':memory:');
for (const migration of fs.readdirSync('worker/migrations').filter(name=>name.endsWith('.sql')).sort())
  db.exec(fs.readFileSync(`worker/migrations/${migration}`, 'utf8'));
db.prepare('INSERT INTO model_catalog(id,name,upstream_id,price_json,enabled) VALUES(?,?,?,?,1)').run('gpt-6-test','Test','gpt-6-test',JSON.stringify({input:2,cached:.2,write:2.5,output:9,longThreshold:272000,longInput:2,longOutput:1.5,tier:'default'}));
const profileId = '11111111-1111-4111-8111-111111111111';
db.prepare('INSERT INTO upstream_profiles(id,name,base_url,api_key_ciphertext,api_key_iv,key_hint) VALUES(?,?,?,?,?,?)').run(profileId,'fixture','https://upstream.invalid/v1','cipher','iv','hint');
db.prepare('INSERT INTO image_model_routes(model_id,name,profile_id,upstream_model_id,billing_model_id,price_json) VALUES(?,?,?,?,?,?)').run('gpt-image-3','Image',profileId,'gpt-image-3','gpt-image-3',JSON.stringify({textInput:5,textCached:1.25,imageInput:8,imageCached:2,imageOutput:29,tier:'default'}));
const env = { DB: { prepare(sql) { let values=[]; return { bind(...args){values=args;return this;}, async first(){return db.prepare(sql).get(...values)||null;}, async all(){return {results:db.prepare(sql).all(...values)};}, async run(){return {meta:{changes:Number(db.prepare(sql).run(...values).changes)}};} }; } } };
let calls=0;
const fetcher=async url=>{calls++;return new Response(url.includes('gpt-image-3')?imageDoc:textDoc,{status:200});};
const text=await verifiedOfficialModel(env,'gpt-6-test',{force:true,fetcher});
assert.equal(text.price.output,10);
assert.equal(JSON.parse(db.prepare("SELECT price_json FROM model_catalog WHERE id='gpt-6-test'").get().price_json).output,10,'official price refresh updates published future requests');
await verifiedOfficialModel(env,'gpt-6-test',{fetcher});
assert.equal(calls,1,'a recent official verification is reused');
await verifiedOfficialModel(env,'gpt-image-3',{force:true,fetcher});
assert.equal(JSON.parse(db.prepare("SELECT price_json FROM image_model_routes WHERE model_id='gpt-image-3'").get().price_json).imageOutput,30);
assert.equal((await verifiedOfficialModel(env,'gpt-6-unlisted',{force:true,fetcher})),null,'a mismatched model page cannot be cached');
const claudeDoc = fs.readFileSync('tests/fixtures/official-pricing/claude-opus-5-5.md','utf8');
const sonnetDoc = fs.readFileSync('tests/fixtures/official-pricing/claude-sonnet-5-5.md','utf8');
assert.equal(parseClaudeModelMarkdown(claudeDoc, 'claude-opus-5-5').price.cached, .2);
assert.equal(parseClaudeModelMarkdown(claudeDoc, 'claude-opus-5-5-20260922'), null);
assert.equal(parseClaudeModelMarkdown(claudeDoc.replace('$0.20 / MTok', 'unknown'), 'claude-opus-5-5'), null);
assert.equal(await fetchClaudeModel('claude-opus-5-5', async () => new Response(null, {status:307})), null);
assert.equal(await fetchClaudeModel('claude-opus-5-5', async () => new Response('<html>Unavailable in region</html>')), null);
const claude = await verifiedOfficialModel(env, 'claude-opus-5-5', {force:true, fetcher:async url=>{
  assert.equal(url, 'https://platform.claude.com/docs/en/models/opus-5-5/overview.md');
  return new Response(claudeDoc);
}});
assert.equal(claude.price.input, 4);
assert.equal(JSON.parse(db.prepare("SELECT model_json FROM official_model_cache WHERE model_id='claude-opus-5-5'").get().model_json).price.output, 20);
assert.equal(parseClaudeModelMarkdown(sonnetDoc,'claude-sonnet-5-5').price.input,2);
assert.equal(parseClaudeModelMarkdown(sonnetDoc,'claude-sonnet-5-5').price.output,10);
assert.deepEqual(parseClaudeModelMarkdown(sonnetDoc,'claude-sonnet-5-5').limit,{context:1000000,output:128000});
assert.equal(parseClaudeModelMarkdown(sonnetDoc.replace('url: https://platform.claude.com/docs/en/models/sonnet-5-5/overview','url: https://example.invalid'),'claude-sonnet-5-5'),null,'wrong source cannot establish a price');
assert.equal(parseClaudeModelMarkdown(sonnetDoc.replace('Model ID: \x60claude-sonnet-5-5\x60','Model ID: \x60claude-opus-5-5\x60'),'claude-sonnet-5-5'),null,'wrong exact ID cannot inherit a price');
assert.equal(parseClaudeModelMarkdown(sonnetDoc.replace('| Input                                                                                  | $2 / MTok                        |','| Input | $2 / MTok |\n| Input | $9 / MTok |'),'claude-sonnet-5-5'),null,'ambiguous duplicate prices fail closed');
assert.equal(parseClaudeModelMarkdown(sonnetDoc.replace('$2.50 / MTok','unknown'),'claude-sonnet-5-5'),null,'a comparison table cannot replace missing cache-write price');
const verification={};
await verifiedOfficialModel(env,'claude-sonnet-5-5',{force:true,fetcher:async()=>new Response(null,{status:503}),verification});
assert.equal(verification.status,'retained','fallback must not be presented as a fresh successful verification');
const fresh={};
await verifiedOfficialModel(env,'claude-sonnet-5-5',{force:true,fetcher:async()=>new Response(sonnetDoc),verification:fresh});
assert.equal(fresh.status,'verified');
const grokDoc=fs.readFileSync('tests/fixtures/official-pricing/grok-4.7.md','utf8');
const grokModel=parseGrokModelMarkdown(grokDoc,'grok-4.7');
assert.equal(supportsOfficialSync('grok-4.7'),true);
assert.equal(grokModel.price.input,2);assert.equal(grokModel.price.cached,.5);assert.equal(grokModel.price.output,6);
assert.equal(grokModel.limit,undefined,'context cannot establish an unspecified maximum output');
assert.equal(grokModel.contextWindow,500000);
assert.equal(parseGrokModelMarkdown(grokDoc.replaceAll('grok-4.7','grok-4.8').replace('Grok 4.7','Grok 4.8'),'grok-4.8').price.output,6,'a future exact ID needs no static price-table entry');
assert.equal(parseGrokModelMarkdown(grokDoc,'grok-4.7-build-fast'),null,'relay aliases cannot inherit a base model price');
for(const malformed of [grokDoc.replace('$0.50','unknown'),grokDoc.replace('$1.00','$2.00'),grokDoc.replace('≥ 200k','≥ 300k'),grokDoc.replace('**Model name:** `grok-4.7`','**Model name:** `grok-4.6`'),grokDoc.replace('| Input | $2.00 | $4.00 |','| Input | $2.00 | $4.00 |\n| Input | $9.00 | $18.00 |'),grokDoc.replace('**Function calling:** Yes','**Function calling:** No'),grokDoc.replace('Requests whose prompt reaches','Prices usually below')])assert.equal(parseGrokModelMarkdown(malformed,'grok-4.7'),null);
assert.equal(await fetchGrokModel('grok-4.7-build-fast',async()=>new Response(null,{status:404})),null);
assert.equal(await fetchGrokModel('grok-4.7',async()=>new Response(null,{status:302})),null);
await assert.rejects(()=>fetchGrokModel('grok-4.7',async()=>new Response('x'.repeat(32769))),/OFFICIAL_DOC_TOO_LARGE/);
const grokSnapshot={price:grokModel.price,multiplierPpm:1000000,usdCnyPpm:1000000};
assert.equal(costMicros({input_tokens:199999,output_tokens:1},grokSnapshot),400004);
assert.equal(costMicros({input_tokens:200000,output_tokens:1},grokSnapshot),800012,'Grok applies long-context rates at the exact threshold');
assert.equal(costMicros({input_tokens:200000,output_tokens:1,input_tokens_details:{cached_tokens:200000}},grokSnapshot),200012,'long-context cached rate scales consistently');
const grokState={};
assert.equal((await verifiedOfficialModel(env,'grok-4.7',{force:true,fetcher:async (url,options)=>{assert.equal(url,'https://docs.x.ai/developers/models/grok-4.7.md');assert.equal(options.headers.accept,'text/plain','xAI Markdown negotiation must use a working Accept header');return new Response(grokDoc);},verification:grokState})).price.output,6);
assert.equal(grokState.status,'verified');
await verifiedOfficialModel(env,'grok-4.7',{force:true,fetcher:async()=>new Response(null,{status:503}),verification:grokState});assert.equal(grokState.status,'retained');
await verifiedOfficialModel(env,'grok-4.7-build-fast',{force:true,fetcher:async()=>new Response(grokDoc),verification:grokState});assert.equal(grokState.status,'unverified');
// A published built-in with no cache must join scheduled verification too.
db.exec("DELETE FROM official_model_cache; UPDATE model_catalog SET enabled=0; UPDATE image_model_routes SET enabled=0");
db.prepare('INSERT INTO model_catalog(id,name,upstream_id,price_json,enabled) VALUES(?,?,?,?,1)').run('grok-4.7','Grok 4.7','grok-4.7',JSON.stringify({...grokModel.price,output:5}));
await refreshCachedOfficialPrices(env,{now:0,fetcher:async()=>new Response(grokDoc)});
assert.equal(JSON.parse(db.prepare("SELECT price_json FROM model_catalog WHERE id='grok-4.7'").get().price_json).output,6);
db.exec("DELETE FROM official_model_cache; UPDATE model_catalog SET enabled=0");
for(let i=0;i<8;i++){
  const id='gpt-rotation-'+i,model=parseOpenAIModelMarkdown(textDoc.replaceAll('gpt-6-test',id),id);
  db.prepare("INSERT INTO official_model_cache(model_id,model_json,fetched_at) VALUES(?,?,datetime('now','-25 hours'))").run(id,JSON.stringify(model));
}
let rotations=0;
const rotationFetch=async url=>{rotations++;const id=url.split('/').at(-1).replace(/\.md$/,'');return new Response(textDoc.replaceAll('gpt-6-test',id));};
assert.equal((await refreshCachedOfficialPrices(env,{now:0,fetcher:rotationFetch})).checked,5);
assert.equal((await refreshCachedOfficialPrices(env,{now:3600000,fetcher:rotationFetch})).checked,3);
assert.equal(rotations,8,'bounded hourly rotation refreshes every model, reusing recent verification');
assert.equal((await refreshCachedOfficialPrices(env,{now:7200000,fetcher:rotationFetch})).checked,0);
db.exec("UPDATE official_model_cache SET fetched_at=datetime('now','-25 hours')");
assert.equal((await refreshCachedOfficialPrices(env,{now:0,fetcher:async()=>new Response(null,{status:503})})).checked,5);
const reached=[];
await refreshCachedOfficialPrices(env,{now:3600000,fetcher:async url=>{reached.push(url);return rotationFetch(url);}});
assert.ok(reached.some(url=>url.endsWith('/gpt-rotation-7.md')),'failed early pages cannot starve later cached models');
// Workers AI fallback parses redesigned official docs with literal dollar grounding, and rejects hallucinated prices.
const redesignedDoc = `# GPT-6.3 Nova\nModel ID: \`gpt-6.3-nova\`\nContext: 1,050,000 tokens, max output 128,000 tokens, supports text & image.\nStandard rates per 1M tokens: Input $3, Cached input $0.15, Cache write $3.75, Output $15.\n`;
let aiCalls = 0;
const aiEnv = {
  ...env,
  PRICE_AI_SYNC_ENABLED: '1',
  AI: {
    async run(model, body) {
      aiCalls++;
      assert.equal(model, PRICE_AI_MODEL);
      assert.ok(JSON.stringify(body).includes('gpt-6.3-nova'));
      return { response: JSON.stringify({ kind: 'text', id: 'gpt-6.3-nova', name: 'GPT-6.3 Nova', reasoning: true, inputModalities: ['text', 'image'], context: 1050000, maxOutput: 128000, input: 3, cached: 0.15, write: 3.75, output: 15, longThreshold: 10000000, longInput: 1, longOutput: 1 }) };
    }
  }
};
const aiParsed = await verifiedOfficialModel(aiEnv, 'gpt-6.3-nova', { force: true, fetcher: async () => new Response(redesignedDoc) });
assert.equal(aiCalls, 1);
assert.equal(aiParsed.price.input, 3);
assert.equal(aiParsed.price.output, 15);
assert.equal(aiParsed.price.parser, 'workers_ai');
const hallucinatingEnv = {
  ...env,
  PRICE_AI_SYNC_ENABLED: '1',
  AI: { async run() { return { response: JSON.stringify({ kind: 'text', id: 'gpt-6.3-bad', name: 'Bad', reasoning: true, inputModalities: ['text'], context: 1050000, maxOutput: 128000, input: 999, cached: 0.15, write: 0, output: 15, longThreshold: 10000000, longInput: 1, longOutput: 1 }) }; } }
};
assert.equal(await verifiedOfficialModel(hallucinatingEnv, 'gpt-6.3-bad', { force: true, fetcher: async () => new Response(redesignedDoc.replaceAll('gpt-6.3-nova', 'gpt-6.3-bad')) }), null, 'hallucinated prices absent from official doc must fail closed');
// Active published models refresh on a 6-hour priority window and support on-demand syncActiveOfficialPrices.
db.exec("DELETE FROM official_model_cache; UPDATE model_catalog SET enabled=0; UPDATE image_model_routes SET enabled=0");
db.prepare("UPDATE model_catalog SET enabled=1 WHERE id='gpt-6-test'").run();
db.prepare("INSERT INTO official_model_cache(model_id,model_json,fetched_at) VALUES('gpt-6-test',?,datetime('now','-7 hours'))").run(JSON.stringify(text));
const prioritySync = await refreshCachedOfficialPrices(env, { now: 0, fetcher: async () => new Response(textDoc.replace('| Output | $10 |', '| Output | $12 |')) });
assert.equal(prioritySync.checked, 1);
assert.equal(prioritySync.updated, 1);
assert.equal(JSON.parse(db.prepare("SELECT price_json FROM model_catalog WHERE id='gpt-6-test'").get().price_json).output, 12);
const activeManual = await syncActiveOfficialPrices(env, { fetcher: async () => new Response(textDoc.replace('| Output | $10 |', '| Output | $11 |')) });
assert.equal(activeManual.checked, 1);
assert.equal(activeManual.updated, 1);
assert.equal(JSON.parse(db.prepare("SELECT price_json FROM model_catalog WHERE id='gpt-6-test'").get().price_json).output, 11);
console.log('Official price sync: exact-ID parsing, fail-closed rules, Workers AI fallback, priority refresh and published-price sync passed');
