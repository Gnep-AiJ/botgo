const http = require('node:http');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { createBridge, MAX_REQUEST_BYTES } = require('./shared/bridge.cjs');

// Hermes' native session_affinity_header covers main turns, auxiliaries and
// compression. Normalize its opaque identity at this boundary, never in history.
function taskId(value) {
  if (typeof value !== 'string' || !value || value.length > 4096) throw Error('Invalid session identity');
  return 'hermes_' + crypto.createHash('sha256').update(value).digest('hex');
}
function catalogFor(config) {
  return Object.entries(config.provider).flatMap(([provider, entry]) =>
    Object.entries(entry.models).map(([id, model]) => ({
      id, name: model.name, protocol: provider.endsWith('responses') ? 'responses' : 'chat',
      limit: model.limit, modalities: model.modalities, reasoning: model.reasoning,
      cost: model.cost,
    })));
}
async function createGateway({ token, port = 0, ...options }) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw Error('Invalid local capability');
  const bridge = await createBridge(options);
  const config = bridge.config();
  const catalog = catalogFor(config);
  const internal = Object.values(config.provider)[0].options;
  const aborts = new Set();
  const server = http.createServer(async (req, res) => {
    const scoped = /^\/(chat|responses)(\/v1\/.*)$/.exec(req.url);
    const route = scoped ? scoped[2] : req.url;
    const fail = (status, code) => { if (!req.complete) req.resume(); if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: code, code } })); };
    const actual = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from('Bearer ' + token);
    if (req.headers.origin || actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return fail(401, 'UNAUTHORIZED');
    if (req.method === 'GET' && route === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ object: 'list', data: catalog.filter(m => !scoped || m.protocol === scoped[1]).map(m => ({ id: m.id, object: 'model', owned_by: 'botgo', name: m.name })) }));
    }
    if (req.method !== 'POST' || !['/v1/chat/completions', '/v1/responses', '/v1/images/generations'].includes(route)) return fail(404, 'UNSUPPORTED_ROUTE');
    if (scoped && (scoped[1] === 'responses' ? route !== '/v1/responses' : route === '/v1/responses')) return fail(403, 'PROTOCOL_UNAVAILABLE');
    const controller = new AbortController(); aborts.add(controller);
    const disconnect = () => { if (!res.writableEnded) controller.abort(); };
    res.once('close', disconnect);
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > MAX_REQUEST_BYTES) return fail(413, 'REQUEST_TOO_LARGE'); chunks.push(chunk); }
      const body = Buffer.concat(chunks);
      const identity = req.headers['x-session-id'] || 'aux-' + crypto.randomUUID();
      const parent = req.headers['x-parent-session-id'];
      const result = await fetch(internal.baseURL + route.slice(3), {
        method: 'POST', redirect: 'error', signal: controller.signal,
        headers: { authorization: 'Bearer ' + internal.apiKey, 'content-type': 'application/json', 'x-session-id': taskId(identity), ...(parent ? { 'x-parent-session-id': taskId(parent) } : {}) },
        body,
      });
      res.writeHead(result.status, { 'content-type': result.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' });
      if (result.body) for await (const chunk of result.body) if (!res.write(Buffer.from(chunk))) await once(res, 'drain', { signal: controller.signal });
      res.end();
    } catch (error) { if (!res.destroyed) fail(error.message === 'Invalid session identity' ? 400 : 502, controller.signal.aborted ? 'CANCELLED' : 'REQUEST_FAILED'); }
    finally { aborts.delete(controller); res.off('close', disconnect); }
  });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); }); }
  catch (error) { await bridge.close(); throw error; }
  return {
    baseURL: `http://127.0.0.1:${server.address().port}/v1`, port: server.address().port,
    catalog, imageModels: bridge.imageConfig()?.models || [], defaultModel: config.model.slice(config.model.indexOf('/') + 1),
    account: bridge.account, usage: identity => bridge.usage(taskId(identity)),
    async close() { for (const abort of aborts) abort.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await bridge.close(); },
  };
}
module.exports = { taskId, catalogFor, createGateway };
