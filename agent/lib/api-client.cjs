const DEFAULT_ORIGIN = "https://botgo.win";

function normalizeOrigin(value = DEFAULT_ORIGIN) {
  let url;
  try { url = new URL(value); } catch { throw new Error("BotGo API origin must be a valid URL"); }
  if (!/^https:$/.test(url.protocol) && !["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("BotGo API origin must use HTTPS");
  }
  return url.origin;
}

function createApiClient({ origin = process.env.BOTGO_API_ORIGIN || DEFAULT_ORIGIN, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("This Node.js version does not provide fetch");
  const baseOrigin = normalizeOrigin(origin);

  async function request(endpoint, { method = "GET", body, deviceToken, signal } = {}) {
    const response = await fetchImpl(`${baseOrigin}/api${endpoint}`, {
      method,
      signal,
      headers: {
        accept: "application/json",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(deviceToken ? { authorization: `Bearer ${deviceToken}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `BotGo service returned HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  return {
    origin: baseOrigin,
    request,
    startAuthorization: (body) => request("/desktop/authorize/start", { method: "POST", body }),
    exchangeAuthorization: (body) => request("/desktop/authorize/exchange", { method: "POST", body }),
    cancelAuthorization: (body) => request("/desktop/authorize/cancel", { method: "POST", body }),
    account: (deviceToken) => request("/desktop/account", { deviceToken }),
    issueKey: (deviceToken) => request("/desktop/key", { method: "POST", deviceToken }),
    revoke: (deviceToken) => request("/desktop/revoke", { method: "POST", deviceToken })
  };
}

module.exports = { createApiClient, normalizeOrigin, DEFAULT_ORIGIN };
