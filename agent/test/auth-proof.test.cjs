const assert = require("node:assert/strict");
const test = require("node:test");

const { createProof, callbackResultFor } = require("../lib/auth.cjs");

test("authorization callback requires the expected state and a BotGo code", () => {
  const proof = createProof(() => "fixed-proof-value-123");
  assert.deepEqual(proof, { state: "fixed-proof-value-123", verifier: "fixed-proof-value-123" });
  assert.deepEqual(callbackResultFor("/callback?code=bgac_code&state=fixed-proof-value-123", proof.state), { code: "bgac_code" });
  assert.throws(() => callbackResultFor("/callback?code=bgac_code&state=wrong", proof.state), /state/i);
  assert.throws(() => callbackResultFor("/callback?state=fixed-proof-value-123", proof.state), /code/i);
});
