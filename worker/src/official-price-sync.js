import { officialCatalogModel } from './official-pricing.js';

const DOC_ORIGIN = 'https://developers.openai.com';
const MODEL_ID = /^gpt-[a-z0-9][a-z0-9._-]{0,123}$/;
const CLAUDE_ID = /^claude-([a-z]+-\d+(?:-\d+)?)(?:-\d{8})?$/;
const GROK_ID = /^grok-[a-z0-9][a-z0-9._-]{0,122}$/;
export function supportsOfficialSync(id) { return MODEL_ID.test(id) || CLAUDE_ID.test(id) || GROK_ID.test(id); }
const DAY_MS = 24 * 60 * 60 * 1000;

function linesBetween(markdown, heading, nextLevel) {
  const start = markdown.indexOf(heading);
  if (start < 0) return '';
  const content = markdown.slice(start + heading.length);
  const end = content.search(new RegExp(`^#{1,${nextLevel}} `, 'm'));
  return end < 0 ? content : content.slice(0, end);
}

function tokenPrices(section, kind) {
  const table = linesBetween(section, `### ${kind} tokens\n`, 3);
  const values = {};
  for (const line of table.split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.length !== 3 || cells[2] !== '1M tokens' || !/^\$\d+(?:\.\d+)?$/.test(cells[1])) continue;
    values[cells[0]] = Number(cells[1].slice(1));
  }
  return values;
}

function positive(value) { return Number.isFinite(value) && value > 0 && value <= 100000; }

export function parseOpenAIModelMarkdown(markdown, expectedId, date = new Date().toISOString().slice(0, 10)) {
  if (!MODEL_ID.test(expectedId) || typeof markdown !== 'string' || markdown.length > 32768 ||
      !markdown.startsWith('# ') || !markdown.includes(`Model ID: \`${expectedId}\``)) return null;
  const idMatches = [...markdown.matchAll(/^Model ID: `([^`]+)`$/gm)];
  if (idMatches.length !== 1 || idMatches[0][1] !== expectedId) return null;
  const name = /^# ([^\n]{1,128})/m.exec(markdown)?.[1];
  const details = linesBetween(markdown, '## Model details\n', 2);
  const endpoints = linesBetween(markdown, '## Endpoints\n', 2);
  const pricing = linesBetween(markdown, '## Pricing\n', 2);
  const input = /^\- Input modalities: ([^\n]+)/m.exec(details)?.[1]?.split(',').map(item => item.trim());
  const output = /^\- Output modalities: ([^\n]+)/m.exec(details)?.[1]?.split(',').map(item => item.trim());
  if (!name || !input?.includes('text') || input.some(item=>!['text','image'].includes(item)) || !output?.length || !pricing) return null;
  const source = `${DOC_ORIGIN}/api/docs/models/${expectedId}`;
  const base = { id: expectedId, name, provider: 'OpenAI', modalities: { input, output } };
  if (output.length===1 && output[0]==='image' && /^\| Image generation \| `v1\/images\/generations` \| Supported \|$/m.test(endpoints)) {
    const text = tokenPrices(pricing, 'Text');
    const image = tokenPrices(pricing, 'Image');
    if (![text.Input, text['Cached input'], image.Input, image['Cached input'], image.Output].every(positive)) return null;
    return { ...base, agent: false, imagePrice: { textInput: text.Input, textCached: text['Cached input'],
      imageInput: image.Input, imageCached: image['Cached input'], imageOutput: image.Output,
      source, date, tier: 'default' } };
  }
  if (output.length!==1 || output[0]!=='text' || !/v1\/(responses|chat\/completions)` \| Supported \|/.test(endpoints)) return null;
  const text = tokenPrices(pricing, 'Text');
  if (![text.Input, text['Cached input'], text['Cache writes'], text.Output].every(positive)) return null;
  const context = Number((/^\- ([\d,]+) context window$/m.exec(details)?.[1] || '').replaceAll(',', ''));
  const maxOutput = Number((/^\- ([\d,]+) max output tokens$/m.exec(details)?.[1] || '').replaceAll(',', ''));
  if (!Number.isSafeInteger(context) || context < 1000 || !Number.isSafeInteger(maxOutput) || maxOutput < 1) return null;
  const long = /Prompts with more than (\d+)K input tokens are priced at ([\d.]+)x input and cache rates and ([\d.]+)x output/.exec(pricing);
  if (pricing.includes('Prompts with more than') && !long) return null;
  const longThreshold = long ? Number(long[1]) * 1000 : 10000000;
  const longInput = long ? Number(long[2]) : 1;
  const longOutput = long ? Number(long[3]) : 1;
  if (!Number.isSafeInteger(longThreshold) || longThreshold < 1000 || longThreshold > 10000000 ||
      !positive(longInput) || !positive(longOutput)) return null;
  return { ...base, agent: true, reasoning: /^\- Reasoning token support$/m.test(details),
    limit: { context, output: maxOutput }, price: { tier: 'default', input: text.Input,
      cached: text['Cached input'], write: text['Cache writes'], output: text.Output,
      longThreshold, longInput, longOutput, source, date } };
}

async function boundedText(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw Error('OFFICIAL_DOC_EMPTY');
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw Error('OFFICIAL_DOC_TOO_LARGE'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

// Read the model's own specification table, never a comparison or fast/batch table.
export function parseClaudeModelMarkdown(markdown, id, date = new Date().toISOString().slice(0, 10)) {
  const match = CLAUDE_ID.exec(id);
  if (!match || typeof markdown !== 'string' || markdown.length > 131072) return null;
  markdown = markdown.replace(/\r\n/g, '\n');
  const source = `https://platform.claude.com/docs/en/models/${match[1]}/overview`;
  const frontmatter = /^---\n([\s\S]*?)\n---\n/.exec(markdown)?.[1] || '';
  const name = /^title: (Claude [^\n]{1,100})$/m.exec(frontmatter)?.[1];
  const modelIds = [...markdown.matchAll(/^Model ID: `([^`]+)`$/gm)];
  if (!name || /^url: ([^\n]+)$/m.exec(frontmatter)?.[1] !== source ||
      modelIds.length !== 1 || modelIds[0][1] !== id) return null;
  const specs = linesBetween(markdown, '## Specifications\n', 2);
  const ids = linesBetween(specs, '### Model IDs\n', 3);
  const pricing = linesBetween(specs, '### Pricing\n', 3);
  const capabilities = linesBetween(specs, '### Capabilities\n', 3);
  // Markdown labels may be links; strip presentation only, retaining their text.
  const plain = value => value.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '').replace(/\r/g, '');
  const value = (section, label) => {
    const rows = plain(section).split('\n').filter(row => row.trim().startsWith('|'))
      .map(row => row.split('|').slice(1, -1).map(cell => cell.trim()));
    const matches = rows.filter(row => row.length === 2 && row[0] === label);
    return matches.length === 1 ? matches[0][1] : undefined;
  };
  if (!name || value(ids, 'Claude API') !== id || value(capabilities, 'Input → output') !== 'Text and images → text') return null;
  const rate = label => {
    const text = value(pricing, label);
    return /^\$\d+(?:\.\d+)?\s*\/\s*MTok$/.test(text || '') ? Number(text.match(/[\d.]+/)[0]) : NaN;
  };
  const input = rate('Input'), output = rate('Output'), write = rate('5m cache write'), cached = rate('Cache read');
  const tokens = label => {
    const found = /^(\d+(?:\.\d+)?)([KM]?) tokens$/.exec(value(capabilities, label) || '');
    return found ? Number(found[1]) * ({ K: 1000, M: 1000000 }[found[2]] || 1) : NaN;
  };
  const context = tokens('Context window'), maxOutput = tokens('Max output');
  if (![input, output, write, cached].every(positive) || !Number.isSafeInteger(context) || context < 1000 ||
      !Number.isSafeInteger(maxOutput) || maxOutput < 1 || !value(capabilities, 'Thinking')) return null;
  // Ambiguous premium language requires a reviewed parser change, not guessed rates.
  if (/long.context pric|premium.*200|priced differently/i.test(pricing)) return null;
  return { id, name: name.replace(/ Latest$/, ''), provider: 'Anthropic', agent: true,
    reasoning: /Adaptive|Extended/.test(value(capabilities, 'Thinking')),
    modalities: { input: ['text', 'image'], output: ['text'] }, limit: { context, output: maxOutput },
    price: { tier: 'default', input, cached, write, output, longThreshold: 10000000, longInput: 1, longOutput: 1,
      source, date } };
}

export async function fetchClaudeModel(id, fetcher = fetch) {
  const match = CLAUDE_ID.exec(id);
  if (!match) return null;
  const response = await fetcher(`https://platform.claude.com/docs/en/models/${match[1]}/overview.md`,
    { redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { accept: 'text/markdown, text/plain' } });
  if (response.status !== 200) { await response.body?.cancel(); return null; }
  return parseClaudeModelMarkdown(await boundedText(response, 131072), id);
}

export async function fetchOpenAIModel(id, fetcher = fetch) {
  if (!MODEL_ID.test(id)) return null;
  const url = `${DOC_ORIGIN}/api/docs/models/${id}.md`;
  const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(12000),
    headers: { accept: 'text/markdown, text/plain' } });
  if (response.status !== 200) { await response.body?.cancel(); return null; }
  return parseOpenAIModelMarkdown(await boundedText(response, 32768), id);
}

// Each exact model owns its price table. Relay aliases and comparison prices
// cannot establish a billable model, even when they resemble an official name.
export function parseGrokModelMarkdown(markdown, id, date = new Date().toISOString().slice(0, 10)) {
  if (!GROK_ID.test(id) || typeof markdown !== 'string' || markdown.length > 32768) return null;
  markdown = markdown.replace(/\r\n/g, '\n');
  const name = /^# (Grok [^\n]{1,100})$/m.exec(markdown)?.[1];
  const overview = linesBetween(markdown, '## At a glance\n', 2);
  const ids = [...overview.matchAll(/^\- \*\*Model name:\*\* `([^`]+)`$/gm)];
  const modalities = /^\- \*\*Modalities:\*\* (text(?:, image)?) → text$/m.exec(overview)?.[1];
  const context = Number((/^\- \*\*Context window:\*\* ([\d,]+) tokens$/m.exec(overview)?.[1] || '').replaceAll(',', ''));
  const capabilities = linesBetween(markdown, '## Capabilities\n', 2);
  const reasoning = /^\- \*\*Reasoning:\*\* (Yes|No)$/m.exec(capabilities)?.[1];
  if (!name || ids.length !== 1 || ids[0][1] !== id || !modalities || !reasoning ||
      !Number.isSafeInteger(context) || context < 1000 || !/^\- \*\*Function calling:\*\* Yes$/m.test(capabilities)) return null;
  const pricing = linesBetween(markdown, '## Pricing\n', 2);
  const rows = pricing.split('\n').filter(line=>line.startsWith('|')).map(line=>line.split('|').slice(1,-1).map(cell=>cell.trim()));
  const header = rows[0];
  const threshold = /^< (\d+)k prompt tokens \(per 1M tokens\)$/.exec(header?.[1] || '');
  if (header?.length !== 3 || header[0] !== 'Type' || !threshold ||
      header[2] !== `≥ ${threshold[1]}k prompt tokens (per 1M tokens)`) return null;
  const longThreshold = Number(threshold[1]) * 1000;
  if (!Number.isSafeInteger(longThreshold) || longThreshold < 1000 || longThreshold > context ||
      !pricing.includes(`Requests whose prompt reaches ${threshold[1]}k tokens are billed at the higher rate for all tokens in the request.`)) return null;
  const rate = label=>{
    const matches=rows.filter(row=>row[0]===label);
    if(matches.length!==1 || matches[0].length!==3 || matches[0].slice(1).some(cell=>!/^\$\d+(?:\.\d+)?$/.test(cell))) return null;
    const values=matches[0].slice(1).map(cell=>Number(cell.slice(1)));
    return values.every(positive)?values:null;
  };
  const input=rate('Input'),cached=rate('Cached input'),output=rate('Output');
  if(!input||!cached||!output||input[1]<input[0]||output[1]<output[0]||
      Math.abs(input[1]/input[0]-cached[1]/cached[0])>1e-9 ||
      rows.some(row=>!['Type','---','Input','Cached input','Output'].includes(row[0]))) return null;
  // The current official page provides context, but no maximum output. Do not
  // fabricate a native-client output limit from the context window.
  const maxOutput=Number((/^\- \*\*Max output:\*\* ([\d,]+) tokens$/m.exec(overview)?.[1]||'').replaceAll(',',''));
  if(maxOutput && (!Number.isSafeInteger(maxOutput)||maxOutput<1||maxOutput>context))return null;
  const knownLimit=officialCatalogModel(id)?.limit;
  const limit=maxOutput?{context,output:maxOutput}:knownLimit?.context===context?knownLimit:null;
  return {id,name,provider:'xAI',agent:true,reasoning:reasoning==='Yes',contextWindow:context,
    modalities:{input:modalities.split(', '),output:['text']},...(limit?{limit}:{}),
    price:{tier:'default',input:input[0],cached:cached[0],write:0,output:output[0],longThreshold,longThresholdInclusive:true,
      longInput:input[1]/input[0],longOutput:output[1]/output[0],source:`https://docs.x.ai/developers/models/${id}`,date}};
}

export async function fetchGrokModel(id, fetcher = fetch) {
  if (!GROK_ID.test(id)) return null;
  const response=await fetcher(`https://docs.x.ai/developers/models/${id}.md`,
    // xAI's .md endpoint returns 404 when Accept includes text/markdown.
    {redirect:'manual',signal:AbortSignal.timeout(12000),headers:{accept:'text/plain'}});
  if(response.status!==200){await response.body?.cancel();return null;}
  return parseGrokModelMarkdown(await boundedText(response,32768),id);
}

function recent(timestamp, maximumAgeMs) {
  const time = Date.parse((timestamp || '').replace(' ', 'T') + 'Z');
  return Number.isFinite(time) && time <= Date.now() && Date.now() - time < maximumAgeMs;
}

function priceFields(model) {
  const price = model.agent ? model.price : model.imagePrice;
  if (!price) return null;
  const { date, source, ...rates } = price;
  return JSON.stringify(rates);
}

async function updatePublishedPrices(env, model) {
  const price = model.agent ? model.price : model.imagePrice;
  if (model.agent) {
    const current = await env.DB.prepare('SELECT price_json FROM model_catalog WHERE id=? AND archived=0').bind(model.id).first();
    if (current && priceFields({ agent: true, price: JSON.parse(current.price_json) }) !== priceFields(model)) {
      await env.DB.prepare('UPDATE model_catalog SET price_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=? AND archived=0').bind(JSON.stringify(price), model.id).run();
    }
  } else {
    const routes = (await env.DB.prepare('SELECT model_id,price_json FROM image_model_routes WHERE billing_model_id=?').bind(model.id).all()).results || [];
    for (const route of routes) {
      if (priceFields({ agent: false, imagePrice: JSON.parse(route.price_json) }) !== priceFields(model)) {
        await env.DB.prepare('UPDATE image_model_routes SET price_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE model_id=?').bind(JSON.stringify(price), route.model_id).run();
      }
    }
  }
}

export async function verifiedOfficialModel(env, id, { force = false, fetcher = fetch, verification } = {}) {
  const state = (status, checkedAt = null) => { if (verification) Object.assign(verification, {status, checkedAt}); };
  const known = officialCatalogModel(id);
  if (!supportsOfficialSync(id)) { state(known ? 'pinned' : 'unverified'); return known; }
  const cached = await env.DB.prepare('SELECT model_json,fetched_at FROM official_model_cache WHERE model_id=?').bind(id).first();
  if (!force && recent(cached?.fetched_at, DAY_MS)) { state('cached', cached.fetched_at); return JSON.parse(cached.model_json); }
  if (!force && known && !cached) { state('pinned'); return known; }
  let verified = null;
  try { verified = await (CLAUDE_ID.test(id) ? fetchClaudeModel(id, fetcher) : GROK_ID.test(id) ? fetchGrokModel(id, fetcher) : fetchOpenAIModel(id, fetcher)); } catch { /* Retain the last verified price. */ }
  if (!verified) {
    const fallback = cached && recent(cached.fetched_at, 7 * DAY_MS) ? JSON.parse(cached.model_json) : known;
    state(fallback ? 'retained' : 'unverified', cached?.fetched_at || null);
    return fallback;
  }
  await env.DB.prepare(`INSERT INTO official_model_cache(model_id,model_json,fetched_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(model_id) DO UPDATE SET model_json=excluded.model_json,fetched_at=CURRENT_TIMESTAMP`).bind(id, JSON.stringify(verified)).run();
  await updatePublishedPrices(env, verified);
  state('verified', new Date().toISOString());
  return verified;
}

export async function refreshCachedOfficialPrices(env, { now = Date.now(), fetcher = fetch } = {}) {
  // Rotate bounded batches on the existing hourly schedule. Failed pages cannot
  // starve other IDs, and recent successful verifications need no new fetch.
  const cached = (await env.DB.prepare('SELECT model_id,model_json,fetched_at FROM official_model_cache ORDER BY model_id LIMIT 100').all()).results || [];
  const published = (await env.DB.prepare(`SELECT id AS model_id FROM model_catalog WHERE archived=0 AND enabled=1
    UNION SELECT billing_model_id AS model_id FROM image_model_routes WHERE enabled=1 ORDER BY model_id LIMIT 100`).all()).results || [];
  const candidates = [...new Map([...published,...cached].map(row=>[row.model_id,row])).values()]
    .filter(row=>supportsOfficialSync(row.model_id)).sort((a,b)=>a.model_id.localeCompare(b.model_id));
  if (!candidates.length) return { checked: 0, updated: 0 };
  const offset = Math.floor(now / 3600000) * 5 % candidates.length;
  const rows = Array.from({length: Math.min(5, candidates.length)}, (_, i) => candidates[(offset + i) % candidates.length])
    .filter(row => !recent(row.fetched_at, DAY_MS));
  let updated = 0;
  for (const row of rows) {
    let after;
    try { after = await verifiedOfficialModel(env, row.model_id, { force: true, fetcher }); } catch { continue; }
    const before=row.model_json?JSON.parse(row.model_json):officialCatalogModel(row.model_id);
    if (after && (!before || priceFields(after) !== priceFields(before))) updated++;
  }
  return { checked: rows.length, updated };
}
