const assert = require("node:assert/strict");

const {
  createWebAuthorizationProof,
  callbackResultFor
} = require("../desktop/lib/web-auth.cjs");

const proof = createWebAuthorizationProof(() => "fixed-value");
assert.deepEqual(proof, { state: "fixed-value", verifier: "fixed-value" }, "the desktop must keep a state and verifier for the browser hand-off");

const accepted = callbackResultFor("/callback?code=bgac_example&state=fixed-value", "fixed-value");
assert.equal(accepted.code, "bgac_example");
assert.throws(
  () => callbackResultFor("/callback?code=bgac_example&state=other", "fixed-value"),
  /state/i,
  "a callback for a different desktop session must be rejected"
);
assert.throws(
  () => callbackResultFor("/callback?state=fixed-value", "fixed-value"),
  /code/i,
  "an incomplete callback must not finish authorization"
);

console.log("Desktop browser authorization proof test passed");
