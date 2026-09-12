const crypto = require("node:crypto");

function randomProofValue() {
  return crypto.randomBytes(32).toString("base64url");
}

function createProof(createRandomValue = randomProofValue) {
  return { state: createRandomValue(), verifier: createRandomValue() };
}

function callbackResultFor(requestUrl, expectedState) {
  const callback = new URL(requestUrl, "http://127.0.0.1");
  if (callback.pathname !== "/callback") throw new Error("Unexpected authorization callback path");
  const code = callback.searchParams.get("code");
  const state = callback.searchParams.get("state");
  if (!code || !/^bgac_[A-Za-z0-9_-]{1,256}$/.test(code)) throw new Error("Authorization callback code is missing or invalid");
  if (!state || typeof expectedState !== "string") throw new Error("Authorization callback state does not match");
  const actual = Buffer.from(state);
  const expected = Buffer.from(expectedState);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) throw new Error("Authorization callback state does not match");
  return { code };
}

module.exports = { createProof, createWebAuthorizationProof: createProof, callbackResultFor, randomProofValue };
