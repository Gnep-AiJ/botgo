import { officialCatalogModel } from './official-pricing.js';

const DOC_ORIGIN = 'https://developers.openai.com';
const MODEL_ID = /^gpt-[a-z0-9][a-z0-9._-]{0,123}$/;
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

export async function fetchOpenAIModel(id, fetcher = fetch) {
  if (!MODEL_ID.test(id)) return null;
  const url = `${DOC_ORIGIN}/api/docs/models/${id}.md`;
  const response = await fetcher(url, { redirect: 'manual', signal: AbortSignal.timeout(12000),
    headers: { accept: 'text/markdown, text/plain' } });
  if (response.status !== 200) { await response.body?.cancel(); return null; }
  return parseOpenAIModelMarkdown(await boundedText(response, 32768), id);
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

export async function verifiedOfficialModel(env, id, { force = false, fetcher = fetch } = {}) {
  const known = officialCatalogModel(id);
  if (!MODEL_ID.test(id)) return known;
  const cached = await env.DB.prepare('SELECT model_json,fetched_at FROM official_model_cache WHERE model_id=?').bind(id).first();
  if (!force && recent(cached?.fetched_at, DAY_MS)) return JSON.parse(cached.model_json);
  if (!force && known && !cached) return known;
  let verified = null;
  try { verified = await fetchOpenAIModel(id, fetcher); } catch { /* Retain the last verified price. */ }
  if (!verified) return cached && recent(cached.fetched_at, 7 * DAY_MS) ? JSON.parse(cached.model_json) : known;
  await env.DB.prepare(`INSERT INTO official_model_cache(model_id,model_json,fetched_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(model_id) DO UPDATE SET model_json=excluded.model_json,fetched_at=CURRENT_TIMESTAMP`).bind(id, JSON.stringify(verified)).run();
  await updatePublishedPrices(env, verified);
  return verified;
}

export async function refreshCachedOfficialPrices(env) {
  const rows = (await env.DB.prepare('SELECT model_id FROM official_model_cache ORDER BY fetched_at ASC LIMIT 30').all()).results || [];
  let updated = 0;
  for (const row of rows) {
    const before = await env.DB.prepare('SELECT model_json FROM official_model_cache WHERE model_id=?').bind(row.model_id).first();
    try { await verifiedOfficialModel(env, row.model_id, { force: true }); } catch { continue; }
    const after = await env.DB.prepare('SELECT model_json FROM official_model_cache WHERE model_id=?').bind(row.model_id).first();
    if (after && priceFields(JSON.parse(after.model_json)) !== priceFields(JSON.parse(before.model_json))) updated++;
  }
  return { checked: rows.length, updated };
}
