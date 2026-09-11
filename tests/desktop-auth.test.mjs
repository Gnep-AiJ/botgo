import assert from "node:assert/strict";
import {
  issueDesktopSession,
  issueDesktopKey,
  desktopRelayCredentialFor,
  revokeDesktopDevice
} from "../worker/src/desktop-auth.js";

const records = {
  accounts: new Map([["alice@botgo.test", { id: "account-1", email: "alice@botgo.test", credit_balance: 4, status: "active" }]]),
  loginCodes: new Map([["login-hash", { token_hash: "login-hash", email: "alice@botgo.test", expires_at: "2099-01-01T00:00:00.000Z", consumed_at: null }]]),
  subscriptions: new Map([["account-1", { plan: "free", status: "active", expires_at: null }]]),
  devices: new Map(),
  keys: []
};

const db = {
  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  },
  prepare(sql) {
    return {
      bind(...values) {
        return {
          async first() {
            if (sql.includes("FROM email_login_codes")) return records.loginCodes.get(values[0]) || null;
            if (sql.includes("FROM accounts WHERE email")) return records.accounts.get(values[0]) || null;
            if (sql.includes("FROM accounts WHERE id")) return [...records.accounts.values()].find((account) => account.id === values[0]) || null;
            if (sql.includes("FROM device_tokens")) return records.devices.get(values[0]) || null;
            if (sql.includes("FROM api_keys k JOIN accounts a")) {
              const key = records.keys.find((item) => item.key_hash === values[0] && item.scope === "desktop" && !item.revoked_at);
              const device = key ? records.devices.get(key.device_token_hash) : null;
              if (!key || !device || device.revoked_at || device.expires_at <= new Date().toISOString()) return null;
              const account = records.accounts.get("alice@botgo.test");
              return { id: key.id, account_id: key.account_id, email: account.email, credit_balance: account.credit_balance, status: account.status, plan: "free", subscription_status: "active", subscription_expires_at: null };
            }
            if (sql.includes("FROM subscriptions")) return records.subscriptions.get(values[0]) || null;
            throw new Error(`Unexpected first query: ${sql}`);
          },
          async run() {
            if (sql.startsWith("UPDATE email_login_codes")) {
              records.loginCodes.get(values[0]).consumed_at = "now";
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith("INSERT INTO device_tokens")) {
              records.devices.set(values[0], { token_hash: values[0], account_id: values[1], label: values[2], expires_at: values[3], revoked_at: null });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith("UPDATE api_keys SET revoked_at")) {
              for (const key of records.keys) if (key.device_token_hash === values[0] && !key.revoked_at) key.revoked_at = "now";
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith("INSERT INTO api_keys")) {
              records.keys.push({ id: values[0], account_id: values[1], key_hash: values[2], key_prefix: values[3], label: values[4], scope: "desktop", device_token_hash: values[5], revoked_at: null });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith("UPDATE device_tokens SET revoked_at")) {
              records.devices.get(values[0]).revoked_at = "now";
              return { meta: { changes: 1 } };
            }
            throw new Error(`Unexpected run query: ${sql}`);
          }
        };
      }
    };
  }
};

const sha256 = async (value) => value === "login:alice@botgo.test:123456" ? "login-hash" : `hash:${value}`;
const requestId = (() => { let value = 0; return () => `id-${++value}`; })();
const env = { DB: db };

const session = await issueDesktopSession(env, { email: "alice@botgo.test", code: "123456", deviceLabel: "DESKTOP-01" }, { sha256, requestId });
assert.equal(session.account.email, "alice@botgo.test");
assert.match(session.deviceToken, /^bgdt_/);
assert.equal(records.loginCodes.get("login-hash").consumed_at, "now");

const firstKey = await issueDesktopKey(env, session.deviceToken, { sha256, requestId });
const secondKey = await issueDesktopKey(env, session.deviceToken, { sha256, requestId });
assert.match(firstKey.key, /^bgk_/);
assert.notEqual(firstKey.key, secondKey.key);
assert.equal(records.keys.filter((key) => key.scope === "desktop" && !key.revoked_at).length, 1, "rotating a desktop key must keep only this device's latest key active");

const activeRelayCredential = await desktopRelayCredentialFor(env, secondKey.key, { sha256 });
assert.equal(activeRelayCredential.account.id, "account-1", "an active device may use its current desktop relay key");
records.devices.get(`hash:${session.deviceToken}`).expires_at = "2000-01-01T00:00:00.000Z";
assert.equal(await desktopRelayCredentialFor(env, secondKey.key, { sha256 }), null, "an expired desktop device must not retain relay access through its old key");
records.devices.get(`hash:${session.deviceToken}`).expires_at = "2099-01-01T00:00:00.000Z";

await revokeDesktopDevice(env, session.deviceToken, { sha256 });
assert.equal([...records.devices.values()][0].revoked_at, "now");
assert.equal(records.keys.filter((key) => key.scope === "desktop" && !key.revoked_at).length, 0, "revoking a device must revoke only its desktop key");
assert.equal(await desktopRelayCredentialFor(env, secondKey.key, { sha256 }), null, "a revoked desktop device must not retain relay access through its old key");

console.log("Desktop device credential lifecycle test passed");
