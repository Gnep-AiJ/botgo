import {
  alipayPaymentConfiguration,
  amountMatchesCents,
  closeTrade,
  createPaymentForm,
  createPaymentUrl,
  paidTradeNotification,
  publicPaymentConfiguration,
  publicPaymentDiagnostics,
  queryTrade,
  refundQuery,
  refundTrade,
  RECHARGE_MAX_CENTS,
  RECHARGE_MIN_CENTS,
  validateCheckoutRequest,
  verifyNotify
} from "./alipay-payment.js";
import { cryptoErrorCode } from "./alipay-crypto.js";

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

function text(body, status = 200, headers = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

async function bodyOf(request) {
  try { return await request.json(); } catch { return null; }
}

function nonEmpty(value, max = 256) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;
}

function decodePathValue(value) {
  try { return decodeURIComponent(value); } catch { return ""; }
}

export function orderIdentifier(body, routeIdentifier = "") {
  for (const value of [routeIdentifier, body?.orderId, body?.outTradeNo]) {
    if (nonEmpty(value, 128)) return value.trim();
  }
  return "";
}

function safeProviderResult(result = {}) {
  const fields = [
    "code", "msg", "sub_code", "sub_msg", "trade_no", "out_trade_no", "trade_status",
    "refund_status", "fund_change", "refund_fee", "out_request_no", "total_amount"
  ];
  return Object.fromEntries(fields.filter((field) => result[field] !== undefined).map((field) => [field, result[field]]));
}

function orderPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    outTradeNo: row.out_trade_no,
    amountCents: row.amount_cents,
    includedCredits: row.included_credits,
    status: row.status,
    tradeStatus: row.trade_status || null,
    providerTradeNo: row.provider_trade_no || null,
    refundedAmountCents: row.refunded_amount_cents || 0,
    createdAt: row.created_at,
    paidAt: row.paid_at
  };
}

function newOutTradeNo() {
  // Alipay accepts a merchant order number up to 64 characters. Keep it
  // deterministic-looking but free of email/account data.
  return `BGO${Date.now().toString(36).toUpperCase()}${crypto.randomUUID().replaceAll("-", "").slice(0, 20).toUpperCase()}`.slice(0, 64);
}

function newRefundRequestNo(orderId) {
  return `BGOR${orderId.replaceAll("-", "").slice(0, 18).toUpperCase()}${Date.now().toString(36).toUpperCase()}`.slice(0, 64);
}

function paymentError(configuration) {
  if (configuration.reason === "unsupported_sign_type") return "当前 Worker 实现仅支持支付宝 RSA2；SM2 需要经过支付宝确认的独立 Provider。";
  if (configuration.reason === "invalid_private_key_type") return "支付宝支付配置的私钥类型必须为 PKCS1。";
  if (configuration.reason === "invalid_certificate_material") return "支付宝证书模式需要同时配置应用证书、支付宝公钥证书和支付宝根证书。";
  if (configuration.reason === "invalid_gateway") return "支付宝网关必须是有效的 HTTPS 地址。";
  if (configuration.reason === "missing_key_material") return "支付宝支付尚未配置完整密钥。";
  if (configuration.reason === "missing_seller_identity") return "支付宝支付尚未配置商户身份。";
  if (configuration.reason === "invalid_public_key_role") return "支付宝公钥配置错误：ALIPAY_PUBLIC_KEY 必须填写支付宝公钥，不能填写应用公钥。";
  if (configuration.reason === "invalid_key_material") return "支付宝密钥无法完成验签，请重新核对应用私钥和支付宝公钥。";
  return "支付宝支付配置不可用。";
}

function diagnosticPaymentBlockReason(diagnostics) {
  if (!diagnostics) return null;
  if (diagnostics.keyPair === "matches") return "invalid_public_key_role";
  if (diagnostics.privateKey !== "valid" || diagnostics.publicKey !== "valid") return "invalid_key_material";
  return null;
}

function paymentGenerationError(reason) {
  if (reason === "invalid_base64") return "支付宝应用私钥不是有效的 Base64/PEM 内容，请重新上传密钥值。";
  if (reason === "invalid_der") return "支付宝应用私钥不是可识别的 RSA PKCS#1/PKCS#8 密钥。";
  if (reason === "public_key_material") return "ALIPAY_PRIVATE_KEY 当前上传的是公钥，请改为上传支付宝开放平台生成的应用私钥。";
  if (reason === "encrypted_private") return "ALIPAY_PRIVATE_KEY 是加密私钥，当前 Worker 只接受未加密的 RSA2 PKCS#1/PKCS#8 私钥。";
  if (reason === "crypto_import_failed") return "支付宝应用私钥无法由 Worker 导入，请确认使用 RSA2 私钥。";
  return "当前 Worker 无法执行 RSA2 签名，请稍后重试。";
}

async function accountFor(request, env, helpers) {
  const session = await helpers.sessionFor(request, env);
  if (!session?.sub) return null;
  const account = await env.DB.prepare("SELECT id, email, credit_balance, status FROM accounts WHERE id = ?").bind(session.sub).first();
  return account?.status === "active" ? account : null;
}

async function findOrder(env, accountId, identifier) {
  if (!nonEmpty(identifier, 128)) return null;
  return env.DB.prepare(
    "SELECT * FROM billing_orders WHERE account_id = ? AND (id = ? OR out_trade_no = ?) LIMIT 1"
  ).bind(accountId, identifier.trim(), identifier.trim()).first();
}

async function findAdminOrder(env, identifier) {
  if (!nonEmpty(identifier, 128)) return null;
  return env.DB.prepare("SELECT * FROM billing_orders WHERE id = ? OR out_trade_no = ? LIMIT 1")
    .bind(identifier.trim(), identifier.trim()).first();
}

async function applyPaidOrder(env, order, providerResult) {
  if (!order) return { applied: false, order: null };
  if (order.status === "paid") return { applied: false, order };

  const paidUpdate = await env.DB.prepare(
    "UPDATE billing_orders SET status = 'paid', provider_trade_no = COALESCE(?, provider_trade_no), trade_status = ?, paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'"
  ).bind(providerResult?.trade_no || null, providerResult?.trade_status || "TRADE_SUCCESS", order.id).run();
  if (!paidUpdate.meta?.changes) {
    return { applied: false, order: await env.DB.prepare("SELECT * FROM billing_orders WHERE id = ?").bind(order.id).first() };
  }

  // Recharge orders only increase the monetary balance. They deliberately do
  // not renew or create a Pro subscription anymore.
  await env.DB.prepare("UPDATE accounts SET credit_balance = credit_balance + ? WHERE id = ?")
    .bind(order.included_credits, order.account_id).run();
  return { applied: true, order: await env.DB.prepare("SELECT * FROM billing_orders WHERE id = ?").bind(order.id).first() };
}

async function recordTradeStatus(env, order, providerResult) {
  if (!order || !providerResult) return order;
  const status = typeof providerResult.trade_status === "string" ? providerResult.trade_status.slice(0, 64) : null;
  if (!status) return order;
  await env.DB.prepare("UPDATE billing_orders SET trade_status = ?, provider_trade_no = COALESCE(?, provider_trade_no), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
    .bind(status, providerResult.trade_no || null, order.id).run();
  return env.DB.prepare("SELECT * FROM billing_orders WHERE id = ?").bind(order.id).first();
}

async function checkout(request, env, helpers) {
  const account = await accountFor(request, env, helpers);
  if (!account) return json({ error: "请先登录。" }, 401);
  const body = await bodyOf(request);
  const checkoutRequest = validateCheckoutRequest(body);
  if (!checkoutRequest) return json({ error: "支付请求标识不正确。" }, 400);

  const configuration = alipayPaymentConfiguration(env);
  if (!configuration.available) return json({ error: paymentError(configuration), reason: configuration.reason }, 503);
  const diagnostics = await publicPaymentDiagnostics(env);
  const diagnosticReason = diagnosticPaymentBlockReason(diagnostics);
  if (diagnosticReason) return json({ error: paymentError({ reason: diagnosticReason }), reason: diagnosticReason }, 503);
  const amountCents = checkoutRequest.amountCents;
  if (amountCents < RECHARGE_MIN_CENTS || amountCents > RECHARGE_MAX_CENTS) return json({ error: "充值金额必须在 ￥10 至 ￥9999 之间。" }, 400);

  let order = await env.DB.prepare("SELECT * FROM billing_orders WHERE account_id = ? AND idempotency_key = ? LIMIT 1")
    .bind(account.id, checkoutRequest.idempotencyKey).first();
  if (order && Number(order.amount_cents) !== amountCents) return json({ error: "该支付请求已绑定其他金额，请重新选择充值金额。" }, 409);
  if (!order) {
    order = {
      id: crypto.randomUUID(),
      account_id: account.id,
      amount_cents: amountCents,
      included_credits: amountCents,
      status: "pending",
      out_trade_no: newOutTradeNo(),
      subject: `BotGo 额度充值 ￥${(amountCents / 100).toFixed(2)}`,
      idempotency_key: checkoutRequest.idempotencyKey
    };
    try {
      await env.DB.prepare("INSERT INTO billing_orders (id, account_id, plan_id, amount_cents, included_credits, status, provider, out_trade_no, subject, idempotency_key) VALUES (?, ?, 'credit', ?, ?, 'pending', 'alipay', ?, ?, ?)")
        .bind(order.id, order.account_id, order.amount_cents, order.included_credits, order.out_trade_no, order.subject, order.idempotency_key).run();
    } catch (error) {
      // A concurrent request may have won the idempotency race.
      order = await env.DB.prepare("SELECT * FROM billing_orders WHERE account_id = ? AND idempotency_key = ? LIMIT 1")
        .bind(account.id, checkoutRequest.idempotencyKey).first();
      if (!order) throw error;
    }
  }

  if (order.status !== "pending") return json({ order: orderPublic(order), paymentUrl: null, paymentHtml: null });
  let paymentUrl;
  let paymentHtml;
  try {
    paymentUrl = await createPaymentUrl(env, request, {
      outTradeNo: order.out_trade_no,
      amountCents: order.amount_cents,
      subject: order.subject || `BotGo 额度充值 ￥${(order.amount_cents / 100).toFixed(2)}`
    });
    paymentHtml = await createPaymentForm(env, request, {
      outTradeNo: order.out_trade_no,
      amountCents: order.amount_cents,
      subject: order.subject || `BotGo 额度充值 ￥${(order.amount_cents / 100).toFixed(2)}`
    });
  } catch (error) {
    let reason = cryptoErrorCode(error);
    if (reason === "invalid_der") {
      const diagnostics = await publicPaymentDiagnostics(env);
      if (diagnostics.privateKey === "public_key_material" || diagnostics.privateKey === "encrypted_private") reason = diagnostics.privateKey;
    }
    console.error("alipay_form_generation_failed", reason);
    return json({ error: paymentGenerationError(reason), code: "alipay_form_generation_failed", reason }, 503);
  }
  return json({ order: orderPublic(order), paymentUrl, paymentHtml });
}

function tradeState(result) {
  return {
    TRADE_SUCCESS: "paid",
    TRADE_FINISHED: "paid",
    WAIT_BUYER_PAY: "pending",
    TRADE_CLOSED: "closed"
  }[result?.trade_status] || "unknown";
}

async function queryForOrder(env, order) {
  const result = await queryTrade(env, order.out_trade_no);
  if (result?.code === "10000" && (result.trade_status === "TRADE_SUCCESS" || result.trade_status === "TRADE_FINISHED") && amountMatchesCents(order.amount_cents, result.total_amount)) {
    return { result, ...(await applyPaidOrder(env, order, result)) };
  }
  if (result?.code === "10000" && result.trade_status === "TRADE_CLOSED") {
    await env.DB.prepare("UPDATE billing_orders SET status = 'closed', trade_status = ?, closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
      .bind(result.trade_status, order.id).run();
  } else if (result?.code === "10000") {
    await recordTradeStatus(env, order, result);
  }
  return { result, applied: false, order: await env.DB.prepare("SELECT * FROM billing_orders WHERE id = ?").bind(order.id).first() };
}

async function query(request, env, helpers, adminOnly = false, routeIdentifier = "") {
  const account = adminOnly ? null : await accountFor(request, env, helpers);
  if (!adminOnly && !account) return json({ error: "请先登录。" }, 401);
  const body = await bodyOf(request);
  const identifier = orderIdentifier(body, routeIdentifier);
  const order = adminOnly ? await findAdminOrder(env, identifier) : await findOrder(env, account.id, identifier);
  if (!order) return json({ error: "订单不存在。" }, 404);
  if (order.status === "pending") {
    const configuration = alipayPaymentConfiguration(env);
    if (!configuration.available) return json({ error: paymentError(configuration), reason: configuration.reason }, 503);
    try {
      const checked = await queryForOrder(env, order);
      return json({ order: orderPublic(checked.order), provider: safeProviderResult(checked.result), paymentState: tradeState(checked.result) });
    } catch {
      return json({ order: orderPublic(order), paymentState: "unknown", error: "暂时无法查询支付宝订单，请稍后重试。" }, 502);
    }
  }
  return json({ order: orderPublic(order), paymentState: order.status === "paid" ? "paid" : order.status === "closed" ? "closed" : "unknown" });
}

function notifyParams(requestBody) {
  const params = {};
  for (const [key, value] of new URLSearchParams(requestBody).entries()) {
    if (key && key.length <= 128) params[key] = value;
  }
  return params;
}

function sellerMatches(configuration, params) {
  if (configuration.sellerId && params.seller_id && configuration.sellerId !== params.seller_id) return false;
  if (configuration.sellerEmail && params.seller_email && configuration.sellerEmail !== params.seller_email) return false;
  return Boolean(
    (configuration.sellerId && params.seller_id === configuration.sellerId)
      || (configuration.sellerEmail && params.seller_email === configuration.sellerEmail)
  );
}

async function notify(request, env, helpers) {
  if (request.method !== "POST") return text("fail", 405, { allow: "POST" });
  const configuration = alipayPaymentConfiguration(env);
  if (!configuration.available) return text("fail", 503);
  const params = notifyParams(await request.text());
  if (!params.notify_id || !params.out_trade_no || !params.trade_no || !params.trade_status || params.app_id !== configuration.appId || params.sign_type !== "RSA2" || !sellerMatches(configuration, params)) return text("fail", 400);
  if (!amountMatchesCents((await env.DB.prepare("SELECT amount_cents FROM billing_orders WHERE out_trade_no = ?").bind(params.out_trade_no).first())?.amount_cents, params.total_amount)) return text("fail", 400);
  let valid = false;
  try { valid = await verifyNotify(env, params); } catch { valid = false; }
  if (!valid) return text("fail", 400);

  const order = await env.DB.prepare("SELECT * FROM billing_orders WHERE out_trade_no = ? LIMIT 1").bind(params.out_trade_no).first();
  if (!order) return text("fail", 404);
  const inserted = await env.DB.prepare("INSERT OR IGNORE INTO alipay_notify_events (id, notify_id, out_trade_no, trade_no, trade_status) VALUES (?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), params.notify_id, params.out_trade_no, params.trade_no, params.trade_status).run();
  if (!inserted.meta?.changes) return text("success");

  await env.DB.prepare("UPDATE billing_orders SET notify_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
    .bind(params.notify_id, order.id).run();

  if (paidTradeNotification(params) && amountMatchesCents(order.amount_cents, params.total_amount)) {
    await applyPaidOrder(env, order, params);
    await helpers.audit(env, order.account_id, "alipay_payment_paid", { orderId: order.id, tradeStatus: params.trade_status });
  } else {
    await recordTradeStatus(env, order, params);
  }
  return text("success");
}

function htmlEscape(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));
}

async function returnPage(request, env, helpers) {
  const outTradeNo = new URL(request.url).searchParams.get("out_trade_no") || "";
  // The provider's return navigation may be a cross-site top-level request;
  // SameSite/session cookies are not a reliable prerequisite for reconciling a
  // signed provider result. The out_trade_no is opaque and the provider query
  // below still verifies the payment amount and response signature.
  const order = await findAdminOrder(env, outTradeNo);
  let current = order;
  if (order?.status === "pending" && alipayPaymentConfiguration(env).available) {
    try { current = (await queryForOrder(env, order)).order; } catch { /* query fallback is retried by the client */ }
  }
  const status = current?.status === "paid" ? "支付结果已确认" : current?.status === "closed" ? "订单已关闭" : "正在确认支付结果";
  const detail = current ? `订单 ${htmlEscape(current.out_trade_no)}：${status}。` : "请返回 BotGo，在首页账户窗口查询订单状态。";
  const returnPath = current?.out_trade_no ? `/index.html?panel=recharge&out_trade_no=${encodeURIComponent(current.out_trade_no)}` : "/index.html?panel=recharge";
  return new Response(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BotGo 支付结果</title><body style="font-family:system-ui,sans-serif;max-width:42rem;margin:4rem auto;padding:0 1.25rem;color:#172033"><h1>${htmlEscape(status)}</h1><p>${detail}</p><p><a href="${htmlEscape(returnPath)}">返回 BotGo 账户</a></p></body></html>`, {
    status: current ? 200 : 404,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }
  });
}

async function adminRefund(request, env, helpers, order, refundLookup) {
  const admin = await helpers.activeAdminFor(request, env);
  if (!admin) return json({ error: "需要管理员权限。" }, 403);
  if (!order) return json({ error: "订单不存在。" }, 404);
  if (refundLookup) {
    const existing = await env.DB.prepare("SELECT * FROM billing_refunds WHERE order_id = ? ORDER BY created_at DESC LIMIT 1").bind(order.id).first();
    if (!existing) return json({ error: "退款记录不存在。" }, 404);
    return refundLookup(request, env, helpers, admin, order, existing);
  }
  if (order.status !== "paid") return json({ error: "只有已支付订单可以退款。" }, 409);
  const body = await bodyOf(request);
  const remaining = order.amount_cents - Number(order.refunded_amount_cents || 0);
  const amount = body?.amountCents === undefined ? remaining : Number(body.amountCents);
  if (!Number.isInteger(amount) || amount < 1 || amount > remaining) return json({ error: "退款金额超过可退余额。" }, 400);
  const configuration = alipayPaymentConfiguration(env);
  if (!configuration.available) return json({ error: paymentError(configuration), reason: configuration.reason }, 503);
  const outRequestNo = nonEmpty(body?.outRequestNo, 64) ? body.outRequestNo.trim() : newRefundRequestNo(order.id);
  let refund = await env.DB.prepare("SELECT * FROM billing_refunds WHERE out_request_no = ?").bind(outRequestNo).first();
  if (!refund) {
    try {
      await env.DB.prepare("INSERT INTO billing_refunds (id, order_id, out_request_no, refund_amount_cents, status) VALUES (?, ?, ?, ?, 'pending')")
        .bind(crypto.randomUUID(), order.id, outRequestNo, amount).run();
    } catch {
      // Re-read an idempotent retry rather than issuing a second refund request.
    }
    refund = await env.DB.prepare("SELECT * FROM billing_refunds WHERE out_request_no = ?").bind(outRequestNo).first();
  }
  if (!refund || refund.order_id !== order.id || refund.refund_amount_cents !== amount) return json({ error: "退款请求号已经绑定其他退款金额。" }, 409);
  if (refund.status === "succeeded") return json({ refund });
  let result;
  try { result = await refundTrade(env, order, amount, refund.out_request_no); } catch { return json({ error: "支付宝退款请求失败，请使用相同退款请求号重试。" }, 502); }
  const nextStatus = result?.code === "10000" && result.fund_change === "Y" ? "succeeded" : result?.code === "10000" ? "pending" : "failed";
  const refundUpdate = await env.DB.prepare("UPDATE billing_refunds SET status = ?, provider_result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'succeeded'")
    .bind(nextStatus, JSON.stringify(safeProviderResult(result)).slice(0, 8000), refund.id).run();
  if (nextStatus === "succeeded" && refundUpdate.meta?.changes) {
    await env.DB.prepare("UPDATE billing_orders SET refunded_amount_cents = refunded_amount_cents + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND refunded_amount_cents + ? <= amount_cents")
      .bind(refund.refund_amount_cents, order.id, refund.refund_amount_cents).run();
  }
  await helpers.audit(env, admin.id, "alipay_refund_requested", { orderId: order.id, refundId: refund.id, status: nextStatus });
  return json({ refund: await env.DB.prepare("SELECT * FROM billing_refunds WHERE id = ?").bind(refund.id).first(), provider: safeProviderResult(result) }, nextStatus === "failed" ? 502 : 200);
}

async function refundLookup(request, env, helpers, admin, order, refund) {
  const configuration = alipayPaymentConfiguration(env);
  if (!configuration.available) return json({ error: paymentError(configuration), reason: configuration.reason }, 503);
  let result;
  try { result = await refundQuery(env, order, refund.out_request_no); } catch { return json({ error: "支付宝退款查询失败，请稍后重试。" }, 502); }
  if (result?.code === "10000" && result.refund_status === "REFUND_SUCCESS" && refund.status !== "succeeded") {
    const refundUpdate = await env.DB.prepare("UPDATE billing_refunds SET status = 'succeeded', provider_result = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status != 'succeeded'")
      .bind(JSON.stringify(safeProviderResult(result)).slice(0, 8000), refund.id).run();
    if (refundUpdate.meta?.changes) {
      await env.DB.prepare("UPDATE billing_orders SET refunded_amount_cents = refunded_amount_cents + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND refunded_amount_cents + ? <= amount_cents")
        .bind(refund.refund_amount_cents, order.id, refund.refund_amount_cents).run();
    }
  }
  await helpers.audit(env, admin.id, "alipay_refund_queried", { orderId: order.id, refundId: refund.id, status: result?.refund_status || null });
  return json({ refund: await env.DB.prepare("SELECT * FROM billing_refunds WHERE id = ?").bind(refund.id).first(), provider: safeProviderResult(result) });
}

async function adminClose(request, env, helpers, order) {
  const admin = await helpers.activeAdminFor(request, env);
  if (!admin) return json({ error: "需要管理员权限。" }, 403);
  if (!order) return json({ error: "订单不存在。" }, 404);
  if (order.status !== "pending") return json({ error: "只有待支付订单可以关闭。" }, 409);
  const configuration = alipayPaymentConfiguration(env);
  if (!configuration.available) return json({ error: paymentError(configuration), reason: configuration.reason }, 503);
  let result;
  try { result = await closeTrade(env, order); } catch { return json({ error: "支付宝关闭交易失败，请稍后重试。" }, 502); }
  if (result?.code === "10000") await env.DB.prepare("UPDATE billing_orders SET status = 'closed', trade_status = 'TRADE_CLOSED', closed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'").bind(order.id).run();
  await helpers.audit(env, admin.id, "alipay_trade_closed", { orderId: order.id, ok: result?.code === "10000" });
  return json({ order: orderPublic(await env.DB.prepare("SELECT * FROM billing_orders WHERE id = ?").bind(order.id).first()), provider: safeProviderResult(result) }, result?.code === "10000" ? 200 : 502);
}

async function adminOrders(request, env, helpers) {
  const admin = await helpers.activeAdminFor(request, env);
  if (!admin) return json({ error: "需要管理员权限。" }, 403);
  const url = new URL(request.url);
  const status = ["pending", "paid", "closed", "failed"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : null;
  const rows = status
    ? await env.DB.prepare("SELECT o.*, a.email FROM billing_orders o JOIN accounts a ON a.id = o.account_id WHERE o.status = ? ORDER BY o.created_at DESC LIMIT 100").bind(status).all()
    : await env.DB.prepare("SELECT o.*, a.email FROM billing_orders o JOIN accounts a ON a.id = o.account_id ORDER BY o.created_at DESC LIMIT 100").all();
  return json({ orders: (rows.results || []).map((row) => ({ ...orderPublic(row), email: row.email })) });
}

export async function handleAlipayRoute(request, env, path, helpers) {
  if (path === "/billing/plan" && request.method === "GET") {
    const payment = publicPaymentConfiguration(env);
    const keyDiagnostics = payment.paymentAvailable ? await publicPaymentDiagnostics(env) : null;
    const diagnosticReason = diagnosticPaymentBlockReason(keyDiagnostics);
    return json({
      recharge: payment.recharge,
      ...payment,
      ...(diagnosticReason ? { paymentAvailable: false, reason: diagnosticReason } : {}),
      keyDiagnostics
    });
  }
  if (path === "/billing/checkout" && request.method === "POST") return checkout(request, env, helpers);
  if (path === "/billing/query" && request.method === "POST") return query(request, env, helpers);
  if (path === "/billing/notify") return notify(request, env, helpers);
  if (path === "/billing/return" && request.method === "GET") return returnPage(request, env, helpers);

  if (path === "/admin/billing/plan" && request.method === "GET") {
    const plan = await env.DB.prepare("SELECT id, name, price_cents, included_credits, period_days, updated_at FROM billing_settings WHERE id = 'pro'").first();
    const payment = publicPaymentConfiguration(env);
    const keyDiagnostics = payment.paymentAvailable ? await publicPaymentDiagnostics(env) : null;
    const diagnosticReason = diagnosticPaymentBlockReason(keyDiagnostics);
    return json({ plan, ...payment, ...(diagnosticReason ? { paymentAvailable: false, reason: diagnosticReason } : {}), keyDiagnostics, paymentConfigurationDetected: payment.paymentAvailable && !diagnosticReason });
  }
  if (path === "/admin/billing/orders" && request.method === "GET") return adminOrders(request, env, helpers);
  const orderQuery = path.match(/^\/admin\/billing\/orders\/([^/]+)\/query$/);
  if (orderQuery && request.method === "POST") return query(request, env, helpers, true, decodePathValue(orderQuery[1]));
  const refund = path.match(/^\/admin\/billing\/orders\/([^/]+)\/refund$/);
  if (refund && request.method === "POST") return adminRefund(request, env, helpers, await findAdminOrder(env, decodePathValue(refund[1])));
  const refundQueryMatch = path.match(/^\/admin\/billing\/orders\/([^/]+)\/refund-query$/);
  if (refundQueryMatch && request.method === "POST") {
    const order = await findAdminOrder(env, decodePathValue(refundQueryMatch[1]));
    return adminRefund(request, env, helpers, order, refundLookup);
  }
  const close = path.match(/^\/admin\/billing\/orders\/([^/]+)\/close$/);
  if (close && request.method === "POST") return adminClose(request, env, helpers, await findAdminOrder(env, decodePathValue(close[1])));
  return null;
}
