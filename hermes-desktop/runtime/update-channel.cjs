function updateFetch(fetchImpl = fetch) {
  return async (input, options = {}) => {
    const headers = new Headers(options.headers);
    headers.set('x-botgo-client-engine', 'hermes');
    const response = await fetchImpl(input, { ...options, headers });
    if (new URL(String(input)).pathname === '/api/desktop/releases/current' && response.ok) {
      const value = await response.json();
      if (value.engine !== 'hermes' || (value.release && value.release.engine !== 'hermes')) throw Error('Hermes 更新通道尚未发布，请稍后重试。');
      return Response.json(value);
    }
    return response;
  };
}
module.exports = { updateFetch };
