// Only the Node integration tests use this loader; production uses Cloudflare's socket API.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:sockets') return { url: new URL('./web-chat-sockets.mjs', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
}
