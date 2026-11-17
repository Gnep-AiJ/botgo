import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  applyContactOverrides,
  hideContactQr,
  renderWorkerConfig,
  assertNoPlaceholders,
  PLACEHOLDER_SUPPORT_EMAIL,
  PLACEHOLDER_WECHAT_ID,
  PLACEHOLDER_D1_ID,
  PLACEHOLDER_ALIPAY_APP_ID,
  PLACEHOLDER_PUBLIC_ORIGIN
} from "../scripts/deploy-overrides.mjs";

const root = process.cwd();
const template = readFileSync(path.join(root, "index.html"), "utf8");
const workerTemplate = readFileSync(path.join(root, "worker/wrangler.jsonc"), "utf8");

// Committed templates must stay free of merchant and personal values.
assert.match(template, /support@example\.com/);
assert.match(template, /YOUR_WECHAT_ID/);
assert.doesNotMatch(template, /@qq\.com/);
assert.match(workerTemplate, /00000000-0000-0000-0000-000000000000/);
assert.match(workerTemplate, /YOUR_ALIPAY_APP_ID/);

// Without deployment environment the placeholders stay untouched.
const untouched = applyContactOverrides(template, {});
assert.equal(untouched, template);
assert.doesNotMatch(untouched, /owner@botgo\.win/);

// Supplied values replace every occurrence and never leak into the other fields.
const deployed = applyContactOverrides(template, {
  BOTGO_SUPPORT_EMAIL: "owner@botgo.win",
  BOTGO_WECHAT_ID: "botgo_support"
});
assert.equal(deployed.includes(PLACEHOLDER_SUPPORT_EMAIL), false);
assert.equal(deployed.includes(PLACEHOLDER_WECHAT_ID), false);
assert.equal(deployed.split("owner@botgo.win").length - 1 >= 2, true);
assert.equal(deployed.split("botgo_support").length - 1 >= 2, true);

// Malformed values fail closed instead of publishing junk.
assert.throws(() => applyContactOverrides(template, { BOTGO_SUPPORT_EMAIL: "not-an-email" }), /plain email/);
assert.throws(() => applyContactOverrides(template, { BOTGO_WECHAT_ID: "x" }), /6-20 letters/);

// Missing QR hides the block rather than requesting a lost asset.
assert.equal(hideContactQr(template).includes('<figure class="contact-qr" hidden>'), true);

const workerEnv = {
  BOTGO_D1_DATABASE_ID: "11111111-2222-3333-4444-555555555555",
  BOTGO_ALIPAY_APP_ID: "2021000000000000",
  BOTGO_PUBLIC_ORIGIN: "https://botgo.win/"
};
const rendered = renderWorkerConfig(workerTemplate, workerEnv);
assert.equal(rendered.includes(PLACEHOLDER_D1_ID), false);
assert.equal(rendered.includes(PLACEHOLDER_ALIPAY_APP_ID), false);
assert.equal(rendered.includes(PLACEHOLDER_PUBLIC_ORIGIN), false);
assert.match(rendered, /"database_id": "11111111-2222-3333-4444-555555555555"/);
assert.match(rendered, /"ALIPAY_APP_ID": "2021000000000000"/);
assert.match(rendered, /"ALIPAY_NOTIFY_URL": "https:\/\/botgo\.win\/api\/billing\/notify"/);
assert.match(rendered, /"ALIPAY_RETURN_URL": "https:\/\/botgo\.win\/api\/billing\/return"/);

assert.throws(() => renderWorkerConfig(workerTemplate, {}), /BOTGO_D1_DATABASE_ID/);
assert.throws(() => renderWorkerConfig(workerTemplate, { ...workerEnv, BOTGO_D1_DATABASE_ID: "botgo" }), /D1 database UUID/);
assert.throws(() => renderWorkerConfig(workerTemplate, { ...workerEnv, BOTGO_ALIPAY_APP_ID: "123" }), /16 digits/);
assert.throws(() => renderWorkerConfig(workerTemplate, { ...workerEnv, BOTGO_PUBLIC_ORIGIN: "http://botgo.win" }), /https origin/);
assert.throws(() => assertNoPlaceholders(`x ${PLACEHOLDER_SUPPORT_EMAIL} y`), /still present/);
assert.doesNotThrow(() => assertNoPlaceholders("clean"));

console.log("Deploy overrides: template hygiene, contact injection, QR fallback and Worker config rendering passed");
