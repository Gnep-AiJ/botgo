const crypto = require("node:crypto");

function randomProof() {
  return crypto.randomBytes(32).toString("base64url");
}

function createWebAuthorizationProof(createRandomValue = randomProof) {
  return { state: createRandomValue(), verifier: createRandomValue() };
}

function callbackResultFor(requestUrl, expectedState) {
  const callback = new URL(requestUrl, "http://127.0.0.1");
  if (callback.pathname !== "/callback") throw new Error("Unexpected authorization callback path");
  const code = callback.searchParams.get("code");
  const state = callback.searchParams.get("state");
  if (!code || !/^bgac_[A-Za-z0-9_-]{1,256}$/.test(code)) throw new Error("Authorization callback code is missing or invalid");
  if (!state || typeof expectedState !== "string" || state.length !== expectedState.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))) {
    throw new Error("Authorization callback state does not match");
  }
  return { code };
}

module.exports = { callbackResultFor, createWebAuthorizationProof };
