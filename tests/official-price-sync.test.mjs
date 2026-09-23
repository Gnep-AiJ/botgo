import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseOpenAIModelMarkdown, verifiedOfficialModel } from '../worker/src/official-price-sync.js';

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
console.log('Official price sync: exact-ID parsing, fail-closed rules, cache and published-price refresh passed');
