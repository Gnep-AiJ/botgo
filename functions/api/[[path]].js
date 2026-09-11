export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const backendUrl = new URL(context.request.url);
  backendUrl.pathname = requestUrl.pathname.replace(/^\/api/, "") || "/";

  const request = new Request(backendUrl, context.request);
  return context.env.BOTGO_API.fetch(request);
}
