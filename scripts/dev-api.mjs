// Same-origin local API bridge. Production keeps the Pages service binding.
const hopHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
function endToEndHeaders(source) {
  const headers = new Headers(source);
  for (const name of (headers.get('connection') || '').split(',')) if (name.trim()) headers.delete(name.trim());
  for (const name of hopHeaders) headers.delete(name);
  headers.delete('host');
  return headers;
}

export function localApiOrigin(value) {
  if (!value) return null;
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('BOTGO_DEV_API_ORIGIN 必须是本机 Worker 地址，例如 http://127.0.0.1:8787');
  }
  return url.origin;
}

export async function forwardDevApi(request, apiOrigin, fetchBackend = fetch) {
  const json = (error, status) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
  if (!apiOrigin) return json('本地预览未连接后端，请配置 BOTGO_DEV_API_ORIGIN 后重启。', 503);
  const targetOrigin = localApiOrigin(apiOrigin);
  const incoming = new URL(request.url);
  if (incoming.pathname !== '/api' && !incoming.pathname.startsWith('/api/')) return json('接口不存在。', 404);
  const origin = request.headers.get('origin');
  if (!['GET', 'HEAD'].includes(request.method) && ((origin && origin !== incoming.origin) || request.headers.get('sec-fetch-site') === 'cross-site')) {
    return json('请求来源无效。', 403);
  }
  const target = new URL(targetOrigin);
  target.pathname = incoming.pathname.replace(/^\/api/, '') || '/';
  target.search = incoming.search;
  const headers = endToEndHeaders(request.headers);
  if (origin) headers.set('origin', targetOrigin);
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), 15000);
  try {
    const response = await fetchBackend(new Request(target, {
      method: request.method, headers, body: request.body,
      signal: AbortSignal.any([request.signal, abort.signal]), duplex: 'half', redirect: 'manual'
    }));
    const responseHeaders = endToEndHeaders(response.headers);
    responseHeaders.set('cache-control', 'no-store');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  } catch (error) {
    if (request.signal.aborted) throw error;
    return json('本地后端未响应，请检查 Worker 是否已启动。', 503);
  } finally {
    clearTimeout(timeout);
  }
}
