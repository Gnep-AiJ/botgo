import {
  canonicalAlipayParams,
  diagnoseAlipayKeyMaterial,
  signAlipayParams,
  verifyAlipayParams,
  verifyAlipayText
} from "./alipay-crypto.js";

export const ALIPAY_RSA2 = "RSA2";
export const ALIPAY_SM2 = "SM2";
export const RECHARGE_MIN_CENTS = 1_000;
export const RECHARGE_MAX_CENTS = 999_900;
export const RECHARGE_PRESET_CENTS = [1_000, 5_000, 10_000];

function raw(value) {
  return typeof value === "string" ? value : "";
}

export function alipayPaymentConfiguration(env = {}) {
  const appId = raw(env.ALIPAY_APP_ID).trim();
  const privateKey = raw(env.ALIPAY_PRIVATE_KEY || env.ALIPAY_PRIVATE_PKCS_KEY);
  // ALIPAY_PUBLIC_KEY is the historical project name for Alipay's public key.
  // Accept the explicit alias as well, without exposing either value.
  const alipayPublicKey = raw(env.ALIPAY_PUBLIC_KEY || env.ALIPAY_ALIPAY_PUBLIC_KEY);
  const signType = raw(env.ALIPAY_SIGN_TYPE).trim().toUpperCase() || ALIPAY_RSA2;
  const privateKeyType = raw(env.ALIPAY_PRIVATE_KEY_TYPE).trim().toUpperCase() || "PKCS1";
  const appCert = raw(env.ALIPAY_APP_CERT);
  const publicCert = raw(env.ALIPAY_PUBLIC_CERT);
  const rootCert = raw(env.ALIPAY_ROOT_CERT);
  const gateway = raw(env.ALIPAY_GATEWAY).trim() || "https://openapi.alipay.com/gateway.do";
  const hasAnyCertificate = Boolean(appCert.trim() || publicCert.trim() || rootCert.trim());
  const certificateMode = Boolean(appCert.trim() && publicCert.trim() && rootCert.trim());
  if (signType === ALIPAY_SM2) return { available: false, reason: "unsupported_sign_type", signType };
  if (signType !== ALIPAY_RSA2) return { available: false, reason: "invalid_sign_type", signType };
  if (privateKeyType !== "PKCS1") return { available: false, reason: "invalid_private_key_type", signType, privateKeyType };
  if (!appId || !privateKey.trim() || (!alipayPublicKey.trim() && !certificateMode)) return { available: false, reason: "missing_key_material", signType, privateKeyType };
  if (hasAnyCertificate && !certificateMode) return { available: false, reason: "invalid_certificate_material", signType, privateKeyType };
  if (!/^\d{16}$/.test(appId)) return { available: false, reason: "invalid_app_id", signType };
  try {
    const gatewayUrl = new URL(gateway);
    if (gatewayUrl.protocol !== "https:" || gatewayUrl.username || gatewayUrl.password || gatewayUrl.hash) return { available: false, reason: "invalid_gateway", signType };
  } catch {
    return { available: false, reason: "invalid_gateway", signType };
  }
  const sellerId = raw(env.ALIPAY_SELLER_ID).trim();
  const sellerEmail = raw(env.ALIPAY_SELLER_EMAIL).trim().toLowerCase();
  if (!sellerId && !sellerEmail) return { available: false, reason: "missing_seller_identity", signType };
  return {
    available: true,
    appId,
    privateKey,
    alipayPublicKey,
    sellerId,
    sellerEmail,
    signType,
    privateKeyType,
    gateway,
    certificateMode,
    appCert,
    publicCert,
    rootCert
  };
}

export function normalizeAmountCents(value) {
  if (!Number.isInteger(value) || value < 1 || value > 10_000_000_000) return null;
  return (value / 100).toFixed(2);
}

export function formatAlipayTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function validateCheckoutRequest(body) {
  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) return null;
  const amountCents = Number(body?.amountCents);
  if (!Number.isInteger(amountCents) || amountCents < RECHARGE_MIN_CENTS || amountCents > RECHARGE_MAX_CENTS) return null;
  return { idempotencyKey, amountCents };
}

export function paidTradeNotification(params = {}) {
  const paid = params.trade_status === "TRADE_SUCCESS" || params.trade_status === "TRADE_FINISHED";
  return paid && !params.out_biz_no && !params.gmt_refund && !params.refund_fee;
}

function normalizeAmountText(value) {
  const text = raw(value).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  try {
    return `${BigInt(match[1]).toString()}.${(match[2] || "").padEnd(2, "0")}`;
  } catch {
    return null;
  }
}

export function amountMatchesCents(amountCents, actualAmount) {
  const expected = normalizeAmountCents(amountCents);
  const actual = normalizeAmountText(actualAmount);
  return Boolean(expected && actual && expected === actual);
}

export function paymentUrls(request, env = {}) {
  const origin = new URL(request.url).origin;
  const defaultReturnUrl = `${origin}/api/billing/return`;
  const configuredReturnUrl = raw(env.ALIPAY_RETURN_URL).trim();
  const configuredNotifyUrl = raw(env.ALIPAY_NOTIFY_URL).trim();
  const validUrl = (value, { httpsOnly = false } = {}) => {
    if (!value) return "";
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || (httpsOnly && url.protocol !== "https:") || url.username || url.password || url.hash) return "";
      return url.toString();
    } catch {
      return "";
    }
  };
  const returnUrl = validUrl(configuredReturnUrl) || defaultReturnUrl;
  const notifyUrl = validUrl(configuredNotifyUrl, { httpsOnly: true });
  return { returnUrl, notifyUrl };
}

function requireConfiguration(env) {
  const configuration = alipayPaymentConfiguration(env);
  if (!configuration.available) throw new Error(`Alipay payment configuration is unavailable: ${configuration.reason}`);
  return configuration;
}

function htmlEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[character]));
}

function commonAlipayParams(configuration, method, extra = {}) {
  return {
    app_id: configuration.appId,
    method,
    charset: "utf-8",
    sign_type: configuration.signType,
    timestamp: formatAlipayTimestamp(),
    version: "1.0",
    ...extra
  };
}

async function signedParams(configuration, params) {
  const sign = await signAlipayParams(configuration.privateKey, params);
  return { ...params, sign };
}

function pagePaymentParams(env, configuration, request, order) {
  const totalAmount = normalizeAmountCents(order.amountCents);
  if (!totalAmount) throw new Error("Invalid payment amount");
  const { returnUrl, notifyUrl } = paymentUrls(request, env);
  const params = commonAlipayParams(configuration, "alipay.trade.page.pay", {
    return_url: returnUrl,
    biz_content: JSON.stringify({
      out_trade_no: order.outTradeNo,
      total_amount: totalAmount,
      subject: order.subject,
      product_code: "FAST_INSTANT_TRADE_PAY"
    })
  });
  if (notifyUrl) params.notify_url = notifyUrl;
  return params;
}

async function signedPagePaymentParams(env, request, order) {
  const configuration = requireConfiguration(env);
  const params = pagePaymentParams(env, configuration, request, order);
  return { configuration, signed: await signedParams(configuration, params) };
}

export async function createPaymentUrl(env, request, order) {
  const { configuration, signed } = await signedPagePaymentParams(env, request, order);
  const paymentUrl = new URL(configuration.gateway);
  for (const [name, value] of Object.entries(signed)) paymentUrl.searchParams.set(name, String(value));
  return paymentUrl.toString();
}

export async function createPaymentForm(env, request, order) {
  const { configuration, signed } = await signedPagePaymentParams(env, request, order);
  const fields = Object.entries(signed).map(([name, value]) => `<input type="hidden" name="${htmlEscape(name)}" value="${htmlEscape(value)}" />`).join("");
  return `<form action="${htmlEscape(configuration.gateway)}" method="post" name="alipaySubmit" id="alipaySubmit">${fields}</form><script>document.forms["alipaySubmit"].submit();</script>`;
}

function responseSignText(rawResponse, responseKey) {
  let validateText = String(rawResponse || "").trim();
  const startIndex = validateText.indexOf(`${responseKey}"`);
  const lastIndex = validateText.lastIndexOf('"sign"');
  if (startIndex < 0 || lastIndex < 0 || lastIndex <= startIndex) return "";
  validateText = validateText.substring(startIndex + responseKey.length + 1);
  validateText = validateText.substring(0, lastIndex);
  validateText = validateText.replace(/^[^{]*\{/g, "{");
  validateText = validateText.replace(/\}([^}]*)$/g, "}");
  return validateText;
}

async function executeAlipay(env, method, bizContent) {
  const configuration = requireConfiguration(env);
  const params = commonAlipayParams(configuration, method, {
    biz_content: JSON.stringify(bizContent)
  });
  const signed = await signedParams(configuration, params);
  const response = await fetch(configuration.gateway, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
      accept: "application/json"
    },
    body: new URLSearchParams(Object.entries(signed))
  });
  const rawResponse = await response.text();
  if (!response.ok) throw new Error(`Alipay gateway HTTP ${response.status}`);
  let envelope;
  try {
    envelope = JSON.parse(rawResponse);
  } catch {
    throw new Error("Alipay gateway returned invalid JSON");
  }
  const responseKey = `${method.replaceAll(".", "_")}_response`;
  const result = envelope?.[responseKey] || envelope?.error_response;
  if (!result || typeof result !== "object") throw new Error("Alipay gateway response is missing its response object");
  if (envelope.sign && (configuration.alipayPublicKey || configuration.publicCert)) {
    const signedText = responseSignText(rawResponse, responseKey);
    if (!signedText || !(await verifyAlipayText(configuration.alipayPublicKey, signedText, envelope.sign, configuration.publicCert))) {
      throw new Error("Alipay gateway response signature is invalid");
    }
  }
  return result;
}

export async function queryTrade(env, outTradeNo) {
  return executeAlipay(env, "alipay.trade.query", { out_trade_no: outTradeNo });
}

export async function refundTrade(env, order, refundAmount, outRequestNo) {
  const amount = normalizeAmountCents(refundAmount);
  if (!amount) throw new Error("Invalid refund amount");
  return executeAlipay(env, "alipay.trade.refund", {
    out_trade_no: order.outTradeNo,
    refund_amount: amount,
    out_request_no: outRequestNo
  });
}

export async function refundQuery(env, order, outRequestNo) {
  return executeAlipay(env, "alipay.trade.fastpay.refund.query", {
    out_trade_no: order.outTradeNo,
    out_request_no: outRequestNo
  });
}

export async function closeTrade(env, order) {
  return executeAlipay(env, "alipay.trade.close", { out_trade_no: order.outTradeNo });
}

export async function verifyNotify(env, params) {
  const configuration = alipayPaymentConfiguration(env);
  if (!configuration.available) return false;
  return verifyAlipayParams(configuration.alipayPublicKey, params, configuration.publicCert);
}

export function publicPaymentConfiguration(env = {}) {
  const configuration = alipayPaymentConfiguration(env);
  return {
    paymentAvailable: configuration.available,
    signType: configuration.signType,
    reason: configuration.available ? null : configuration.reason,
    notifyConfigured: Boolean(paymentUrls({ url: "https://botgo.invalid" }, env).notifyUrl),
    certificateMode: configuration.available ? configuration.certificateMode : false,
    recharge: {
      minAmountCents: RECHARGE_MIN_CENTS,
      maxAmountCents: RECHARGE_MAX_CENTS,
      presetAmountCents: RECHARGE_PRESET_CENTS
    }
  };
}

// Safe runtime diagnostics: only status categories are returned, never key
// material or provider credentials. This catches secret transport/import
// failures that the synchronous presence check cannot detect.
export async function publicPaymentDiagnostics(env = {}) {
  const configuration = alipayPaymentConfiguration(env);
  if (!configuration.available) return { privateKey: "not_checked", publicKey: "not_checked" };
  return diagnoseAlipayKeyMaterial({
    privateKey: configuration.privateKey,
    publicKey: configuration.alipayPublicKey,
    publicCertificate: configuration.publicCert
  });
}

// Kept exported for deterministic unit tests and diagnostics without exposing key material.
export { canonicalAlipayParams };
