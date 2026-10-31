import assert from "node:assert/strict";
import { createSign, generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  alipayPaymentConfiguration,
  amountMatchesCents,
  canonicalAlipayParams,
  createPaymentForm,
  createPaymentUrl,
  formatAlipayTimestamp,
  normalizeAmountCents,
  paidTradeNotification,
  paymentUrls,
  publicPaymentDiagnostics,
  queryTrade,
  RECHARGE_MAX_CENTS,
  RECHARGE_MIN_CENTS,
  validateCheckoutRequest,
  verifyNotify
} from "../worker/src/alipay-payment.js";
import { diagnoseAlipayKeyMaterial } from "../worker/src/alipay-crypto.js";
import { orderIdentifier } from "../worker/src/alipay-routes.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

assert.equal(normalizeAmountCents(9900), "99.00");
assert.equal(normalizeAmountCents(1), "0.01");
assert.equal(normalizeAmountCents(0), null);
assert.equal(normalizeAmountCents(10_000_000_001), null);
assert.equal(formatAlipayTimestamp(new Date(2026, 0, 2, 3, 4, 5)), "2026-01-02 03:04:05");

const configured = alipayPaymentConfiguration({
  ALIPAY_APP_ID: "2021000000000000",
  ALIPAY_PRIVATE_KEY: "private-key",
  ALIPAY_PUBLIC_KEY: "public-key",
  ALIPAY_SELLER_ID: "2088seller",
  ALIPAY_SIGN_TYPE: "RSA2"
});
assert.equal(configured.available, true);
assert.equal(configured.signType, "RSA2");
assert.equal(configured.privateKeyType, "PKCS1");

const certificateConfigured = alipayPaymentConfiguration({
  ALIPAY_APP_ID: "2021000000000000",
  ALIPAY_PRIVATE_KEY: "private-key",
  ALIPAY_APP_CERT: "app-cert",
  ALIPAY_PUBLIC_CERT: "public-cert",
  ALIPAY_ROOT_CERT: "root-cert",
  ALIPAY_SELLER_ID: "2088seller"
});
assert.equal(certificateConfigured.available, true);
assert.equal(certificateConfigured.certificateMode, true);

const invalidPrivateKeyType = alipayPaymentConfiguration({
  ALIPAY_APP_ID: "2021000000000000",
  ALIPAY_PRIVATE_KEY: "private-key",
  ALIPAY_PUBLIC_KEY: "public-key",
  ALIPAY_SELLER_ID: "2088seller",
  ALIPAY_PRIVATE_KEY_TYPE: "PKCS8"
});
assert.equal(invalidPrivateKeyType.available, false);
assert.equal(invalidPrivateKeyType.reason, "invalid_private_key_type");

const invalidGateway = alipayPaymentConfiguration({
  ALIPAY_APP_ID: "2021000000000000",
  ALIPAY_PRIVATE_KEY: "private-key",
  ALIPAY_PUBLIC_KEY: "public-key",
  ALIPAY_SELLER_ID: "2088seller",
  ALIPAY_GATEWAY: "http://example.invalid/gateway.do"
});
assert.equal(invalidGateway.available, false);
assert.equal(invalidGateway.reason, "invalid_gateway");

const sm2 = alipayPaymentConfiguration({
  ALIPAY_APP_ID: "2021000000000000",
  ALIPAY_PRIVATE_KEY: "private-key",
  ALIPAY_PUBLIC_KEY: "public-key",
  ALIPAY_SIGN_TYPE: "SM2"
});
assert.equal(sm2.available, false);
assert.equal(sm2.reason, "unsupported_sign_type");

assert.equal(RECHARGE_MIN_CENTS, 1000);
assert.equal(RECHARGE_MAX_CENTS, 999900);
assert.deepEqual(validateCheckoutRequest({ idempotencyKey: "checkout-1", amountCents: 1000 }), { idempotencyKey: "checkout-1", amountCents: 1000 });
assert.equal(validateCheckoutRequest({ idempotencyKey: "checkout-1", amountCents: 999 }), null);
assert.equal(validateCheckoutRequest({ idempotencyKey: "checkout-1", amountCents: 999901 }), null);
assert.equal(validateCheckoutRequest({ idempotencyKey: "" }), null);
assert.equal(validateCheckoutRequest({}), null);
assert.equal(amountMatchesCents(9900, "99"), true);
assert.equal(amountMatchesCents(9900, "99.01"), false);
assert.deepEqual(paymentUrls({ url: "https://botgo.win/workspace.html" }, { ALIPAY_NOTIFY_URL: "http://localhost/notify" }), {
  returnUrl: "https://botgo.win/api/billing/return",
  notifyUrl: ""
});
assert.equal(orderIdentifier({}, "order-from-path"), "order-from-path");
assert.equal(orderIdentifier({ orderId: "order-from-body" }, "order-from-path"), "order-from-path");
assert.equal(orderIdentifier({ outTradeNo: "trade-1" }), "trade-1");
assert.equal(orderIdentifier({ orderId: " " }), "");

assert.equal(paidTradeNotification({ trade_status: "TRADE_SUCCESS" }), true);
assert.equal(paidTradeNotification({ trade_status: "TRADE_FINISHED", out_biz_no: "refund-1" }), false);
assert.equal(paidTradeNotification({ trade_status: "WAIT_BUYER_PAY" }), false);

const { privateKey: testPrivateKey, publicKey: testPublicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicExponent: 0x10001
});
const testPrivateKeyBase64 = testPrivateKey.export({ format: "der", type: "pkcs1" }).toString("base64");
const testPublicKeyBase64 = testPublicKey.export({ format: "der", type: "spki" }).toString("base64");
const testPaymentEnv = {
  ALIPAY_APP_ID: "2021000000000000",
  ALIPAY_PRIVATE_KEY: testPrivateKeyBase64,
  ALIPAY_PUBLIC_KEY: testPublicKeyBase64,
  ALIPAY_SELLER_ID: "2088123456789012",
  ALIPAY_SIGN_TYPE: "RSA2",
  ALIPAY_GATEWAY: "https://openapi.example.invalid/gateway.do",
  ALIPAY_NOTIFY_URL: "https://botgo.win/api/billing/notify",
  ALIPAY_RETURN_URL: "https://botgo.win/api/billing/return"
};

const paymentHtml = await createPaymentForm(testPaymentEnv, new Request("https://botgo.win/workspace.html"), {
  outTradeNo: "BGO-TEST-01",
  amountCents: 1,
  subject: "BotGo 测试订单"
});
assert.match(paymentHtml, /action="https:\/\/openapi\.example\.invalid\/gateway\.do"/);
assert.match(paymentHtml, /&quot;total_amount&quot;:&quot;0\.01&quot;/);
assert.match(paymentHtml, /name="sign" value="[^"]+"/);

const paymentUrl = await createPaymentUrl(testPaymentEnv, new Request("https://botgo.win/workspace.html"), {
  outTradeNo: "BGO-TEST-URL-01",
  amountCents: 1,
  subject: "BotGo GET 测试订单"
});
assert.deepEqual(await publicPaymentDiagnostics(testPaymentEnv), {privateKey:'valid',publicKey:'valid',keyPair:'not_applicable'}, 'merchant signing key and Alipay verification key must not be compared as one pair');
const paymentUrlObject = new URL(paymentUrl);
const paymentUrlParams = Object.fromEntries(paymentUrlObject.searchParams.entries());
assert.equal(paymentUrlObject.origin, "https://openapi.example.invalid");
assert.equal(paymentUrlObject.pathname, "/gateway.do");
assert.equal(paymentUrlParams.method, "alipay.trade.page.pay");
assert.equal(paymentUrlParams.sign_type, "RSA2");
assert.equal(paymentUrlParams.biz_content.includes('"total_amount":"0.01"'), true);
assert.equal(await verifyNotify(testPaymentEnv, paymentUrlParams), true);

const pemWithLiteralNewlines = testPrivateKey.export({ format: "pem", type: "pkcs1" }).toString().replace(/\n/g, "\\n");
const normalizedKeyEnv = { ...testPaymentEnv, ALIPAY_PRIVATE_KEY: `ALIPAY_PRIVATE_KEY="${pemWithLiteralNewlines}"` };
assert.deepEqual(await diagnoseAlipayKeyMaterial({
  privateKey: normalizedKeyEnv.ALIPAY_PRIVATE_KEY,
  publicKey: testPaymentEnv.ALIPAY_PUBLIC_KEY
}), { privateKey: "valid", publicKey: "valid", keyPair: "matches" });
assert.deepEqual(await diagnoseAlipayKeyMaterial({
  privateKey: testPaymentEnv.ALIPAY_PUBLIC_KEY,
  publicKey: testPaymentEnv.ALIPAY_PUBLIC_KEY
}), { privateKey: "public_key_material", publicKey: "valid", keyPair: "not_checked" });
await assert.doesNotReject(() => createPaymentForm(normalizedKeyEnv, new Request("https://botgo.win/workspace.html"), {
  outTradeNo: "BGO-TEST-NORMALIZED",
  amountCents: 1,
  subject: "Normalized key"
}));

function formFields(html) {
  const fields = {};
  for (const match of html.matchAll(/name="([^"]+)" value="([^"]*)"/g)) {
    fields[match[1]] = match[2]
      .replaceAll("&quot;", '"')
      .replaceAll("&#39;", "'")
      .replaceAll("&lt;", "<")
      .replaceAll("&gt;", ">")
      .replaceAll("&amp;", "&");
  }
  return fields;
}

const paymentFields = formFields(paymentHtml);
assert.equal(paymentFields.method, "alipay.trade.page.pay");
assert.equal(paymentFields.biz_content.includes('"total_amount":"0.01"'), true);
assert.equal(await verifyNotify(testPaymentEnv, paymentFields), true);
assert.equal(await verifyNotify(testPaymentEnv, { ...paymentFields, biz_content: paymentFields.biz_content.replace("0.01", "0.02") }), false);

const notifyParams = {
  app_id: testPaymentEnv.ALIPAY_APP_ID,
  seller_id: testPaymentEnv.ALIPAY_SELLER_ID,
  sign_type: "RSA2",
  total_amount: "0.01",
  trade_status: "TRADE_SUCCESS",
  out_trade_no: "BGO-TEST-01",
  trade_no: "2026010100000000000000000000",
  notify_id: "notify-test-01"
};
const notifySignText = canonicalAlipayParams(notifyParams);
notifyParams.sign = createSign("RSA-SHA256").update(notifySignText, "utf8").sign(testPrivateKey, "base64");
assert.equal(await verifyNotify(testPaymentEnv, notifyParams), true);
assert.equal(await verifyNotify(testPaymentEnv, { ...notifyParams, total_amount: "0.02" }), false);

let capturedGatewayRequest;
const responseResult = { code: "10000", msg: "Success", trade_status: "TRADE_SUCCESS", total_amount: "0.01" };
const responseSign = createSign("RSA-SHA256").update(JSON.stringify(responseResult), "utf8").sign(testPrivateKey, "base64");
const responseBody = `{"alipay_trade_query_response":${JSON.stringify(responseResult)},"sign":"${responseSign}"}`;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (_url, options) => {
  capturedGatewayRequest = options;
  return new Response(responseBody, { status: 200, headers: { "content-type": "application/json" } });
};
try {
  const queried = await queryTrade(testPaymentEnv, "BGO-TEST-01");
  assert.equal(queried.trade_status, "TRADE_SUCCESS");
  assert.equal(new URLSearchParams(capturedGatewayRequest.body).get("method"), "alipay.trade.query");
} finally {
  globalThis.fetch = originalFetch;
}

const paymentSource = fs.readFileSync(path.join(root, "worker/src/alipay-payment.js"), "utf8");
const routeSource = fs.readFileSync(path.join(root, "worker/src/alipay-routes.js"), "utf8");
const workerEntry = fs.readFileSync(path.join(root, "worker/src/index.js"), "utf8");
const workspaceSource = fs.readFileSync(path.join(root, "workspace.js"), "utf8");
assert.match(paymentSource, /alipay\.trade\.page\.pay/);
assert.match(paymentSource, /alipay\.trade\.query/);
assert.match(paymentSource, /alipay\.trade\.refund/);
assert.match(paymentSource, /alipay\.trade\.fastpay\.refund\.query/);
assert.match(paymentSource, /alipay\.trade\.close/);
assert.match(paymentSource, /createPaymentUrl/);
assert.match(paymentSource, /verifyAlipayParams/);
assert.match(paymentSource, /verifyAlipayText/);
assert.match(routeSource, /new URLSearchParams\(requestBody\)/);
assert.match(routeSource, /await request\.text\(\)/);
assert.match(routeSource, /paymentHtml = await createPaymentForm/);
assert.match(routeSource, /paymentUrl = await createPaymentUrl/);
assert.match(routeSource, /findAdminOrder\(env, outTradeNo\)/);
assert.match(routeSource, /index\.html\?panel=recharge.*out_trade_no/);
assert.match(routeSource, /decodePathValue\(orderQuery\[1\]\)/);
assert.match(workerEntry, /handlePlatformRoute/);
assert.match(workspaceSource, /billing\/query/);
assert.match(workspaceSource, /out_trade_no/);

console.log("Alipay RSA2 payment contract test passed");
