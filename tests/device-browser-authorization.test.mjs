import assert from "node:assert/strict";
import {
  approveDesktopWebAuthorization,
  exchangeDesktopWebAuthorization,
  startDesktopWebAuthorization
} from "../worker/src/desktop-auth.js";

const records = {
  authorizations: new Map(),
  devices: new Map(),
  account: { id: "account-1", email: "alice@botgo.test", credit_balance: 4, status: "active" }
};

const db = {
  async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); },
  prepare(sql) {
    return {
      bind(...values) {
        return {
          async first() {
            if (sql.includes("FROM desktop_authorizations")) return records.authorizations.get(values[0]) || null;
            if (sql.includes("FROM accounts WHERE id")) return values[0] === records.account.id ? records.account : null;
            throw new Error(`Unexpected first query: ${sql}`);
          },
          async run() {
            if (sql.startsWith("INSERT INTO desktop_authorizations")) {
              records.authorizations.set(values[0], { id: values[0], verifier_hash: values[1], device_label: values[2], expires_at: values[3], account_id: null, authorization_code_hash: null, issued_device_token_hash: null, approved_at: null, consumed_at: null, cancelled_at: null });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith("UPDATE desktop_authorizations SET account_id")) {
              const record = records.authorizations.get(values[2]);
              if (!record || record.account_id || record.cancelled_at || record.consumed_at) return { meta: { changes: 0 } };
              record.account_id = values[0]; record.authorization_code_hash = values[1]; record.approved_at = "now";
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith("UPDATE desktop_authorizations SET consumed_at")) {
              const record = records.authorizations.get(values[1]);
              if (!record || record.consumed_at || record.cancelled_at || record.verifier_hash !== values[2] || record.authorization_code_hash !== values[3]) return { meta: { changes: 0 } };
              record.issued_device_token_hash = values[0];
              record.consumed_at = "now";
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith("INSERT INTO device_tokens")) {
              const authorization = records.authorizations.get(values[2]);
              if (!authorization || authorization.issued_device_token_hash !== values[3] || !authorization.consumed_at) return { meta: { changes: 0 } };
              records.devices.set(values[0], { token_hash: values[0], account_id: authorization.account_id, label: authorization.device_label, expires_at: values[1] });
              return { meta: { changes: 1 } };
            }
            throw new Error(`Unexpected run query: ${sql}`);
          }
        };
      }
    };
  }
};

const env = { DB: db };
const sha256 = async (value) => `hash:${value}`;
const requestId = (() => { let count = 0; return () => `request-${++count}`; })();
const tokenFactory = (() => { let count = 0; return (prefix) => `${prefix}_${++count}`; })();

const verifier = "desktop-proof-value-01";
const started = await startDesktopWebAuthorization(env, { deviceLabel: "DESKTOP-01", verifier }, { sha256, requestId });
assert.equal(started.authorizationId, "request-1");
assert.equal(records.authorizations.get(started.authorizationId).verifier_hash, `hash:${verifier}`, "the database stores only a verifier hash");

const approved = await approveDesktopWebAuthorization(env, started.authorizationId, records.account, { sha256, tokenFactory });
assert.match(approved.authorizationCode, /^bgac_/);

const exchanged = await exchangeDesktopWebAuthorization(env, { authorizationId: started.authorizationId, verifier, authorizationCode: approved.authorizationCode }, { sha256, tokenFactory });
assert.match(exchanged.deviceToken, /^bgdt_/);
assert.equal(exchanged.account.email, "alice@botgo.test");
assert.equal(records.authorizations.get(started.authorizationId).consumed_at, "now");
assert.equal(records.devices.size, 1, "a successful one-time exchange creates exactly one device credential");

await assert.rejects(
  () => exchangeDesktopWebAuthorization(env, { authorizationId: started.authorizationId, verifier, authorizationCode: approved.authorizationCode }, { sha256, tokenFactory }),
  (error) => error?.status === 400,
  "an authorization code must not be replayed"
);

console.log("Desktop web authorization lifecycle test passed");
