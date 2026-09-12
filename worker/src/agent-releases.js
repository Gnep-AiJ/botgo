// Public installer artifacts only. The bucket itself remains private.
export async function handleAgentRelease(request, env, path) {
  if (!path.startsWith('/agent/releases/')) return null;
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  if (!env.DESKTOP_RELEASES) return new Response('Release unavailable', { status: 503 });
  const match = path.match(/^\/agent\/releases\/(\d+\.\d+\.\d+)\/(download|manifest)$/);
  const current = path === '/agent/releases/current';
  const manifest = current || match?.[2] === 'manifest';
  if (!match && !current) return new Response('Not found', { status: 404 });
  const object = await env.DESKTOP_RELEASES.get(current ? 'agent/current.json' : `agent/${match[1]}/${manifest ? 'manifest.json' : 'botgo-agent-win-x64.zip'}`);
  if (!object) return new Response('Release not published', { status: 404 });
  const headers = {
    'content-type': manifest ? 'application/json; charset=utf-8' : 'application/zip',
    'cache-control': current ? 'no-store' : 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-length': String(object.size)
  };
  if (!manifest) headers['content-disposition'] = `attachment; filename="botgo-agent-${match[1]}-win-x64.zip"`;
  return new Response(request.method === 'HEAD' ? null : object.body, { headers });
}
