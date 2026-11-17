import { opcpay, opcpayError } from 'opcpay';
import QRCode from 'qrcode';

const route = '/billing/opcpay';
const apiBase = 'https://ai6666.com/opcpay/api/pay/v1';
const callbackOrigin = 'https://botgo.win';
const consumptionReason = '兑换 BotGo 模型使用额度';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const queryIntervalMs = 15_000;

function reply(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

class WorkerOpcpay extends opcpay {
  #apiKey;

  constructor(apiKey) {
    super({ apiKey, baseURL: apiBase });
    this.#apiKey = apiKey;
  }

  async request(path, body, method = body === undefined ? 'GET' : 'POST') {
    // Workers rejects the SDK's redirect:'error' before sending the request.
    const response = await fetch(apiBase + path, {
      method,
      redirect: 'manual',
      headers: { authorization: 'Bearer ' + this.#apiKey, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    const requestId = response.headers.get('x-request-id');
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new opcpayError('Unexpected payment API redirect', response.status, { error_code: 'UNEXPECTED_REDIRECT' }, requestId);
    }
    const result = await response.json().catch(() => null);
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new opcpayError('Invalid payment API response', response.status, { error_code: 'INVALID_RESPONSE' }, requestId);
    }
    if (!response.ok) throw new opcpayError('Payment API request failed', response.status, result, requestId);
    return result;
  }
}

function clientFor(env) {
  const apiKey = env.opcpay_api_key?.trim();
  return apiKey ? new WorkerOpcpay(apiKey) : null;
}

async function capabilities(client) {
  const result = await client.capabilities();
  return result.provider_configured === true ? result.capabilities || {} : {};
}

function providerError(error) {
  if (error?.status === 401 || error?.status === 403) return 'provider_auth';
  if (error?.status === 429) return 'provider_busy';
  if (['INVALID_RESPONSE', 'UNEXPECTED_REDIRECT'].includes(error?.code)) return 'provider_response';
  return 'provider_unavailable';
}

function catalogFailure(stage, error) {
  const reason = providerError(error);
  console.warn(JSON.stringify({ event: 'opcpay_catalog_failure', stage, reason, status: Number.isInteger(error?.status) ? error.status : null }));
  return reason;
}

function pointSku(sku) {
  if (sku?.billing_mode !== 'QUANTITY' || sku.quota_unit !== 'POINT' || sku.entitlement_rule !== 'QUOTA' ||
      sku.currency !== 'CNY' || !Number.isSafeInteger(sku.quota_amount) || sku.quota_amount < 1 ||
      !Number.isSafeInteger(sku.price_version) || typeof sku.sku_id !== 'string' || !sku.sku_id ||
      typeof sku.price !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(sku.price)) return null;
  const amountCents = sku.quota_amount * 100;
  if (!Number.isSafeInteger(amountCents) || Number(sku.price) !== sku.quota_amount) return null;
  return {
    id: sku.sku_id, name: typeof sku.display_name === 'string' ? sku.display_name : '',
    points: sku.quota_amount, amountCents, version: sku.price_version,
  };
}

function checkoutPlans(product, flags) {
  if (!['purchase_entry', 'entitlement_query', 'consumption', 'transaction_query'].every(key => flags[key] === true)) return [];
  if (product.capability_status !== 'ENABLED' || product.billing_mode !== 'QUANTITY' || product.quota_unit !== 'POINT') return [];
  return (product.charging_options || []).map(pointSku).filter(Boolean);
}

async function catalogFor(client) {
  if (!client) return { flags: {}, plans: [], catalogStatus: 'unavailable', reason: 'secret_missing' };
  const [caps, product] = await Promise.allSettled([capabilities(client), client.product()]);
  const flags = caps.status === 'fulfilled' ? caps.value : {};
  if (caps.status === 'rejected' || product.status === 'rejected') {
    const reason = caps.status === 'rejected' ? catalogFailure('capabilities', caps.reason) : catalogFailure('product', product.reason);
    return { flags, plans: [], catalogStatus: 'unavailable', reason };
  }
  const plans = checkoutPlans(product.value, flags);
  return { flags, plans, catalogStatus: plans.length ? 'ready' : 'closed', reason: plans.length ? null : 'plan_unavailable' };
}

function purchaseLink(url) {
  if (typeof url !== 'string' || url.length > 4096) return null;
  const target = URL.canParse(url) ? new URL(url) : null;
  return target && ['https:', 'alipays:'].includes(target.protocol) && !target.username && !target.password ? url : null;
}

function purchaseExpiry(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return NaN;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return Date.parse(value.replace(' ', 'T') + '+08:00');
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}

function publicOrder(order) {
  const purchaseExpired = !!order.purchase_expires_at && Date.parse(order.purchase_expires_at) <= Date.now();
  return {
    id: order.id, skuId: order.sku_id, points: order.points, amountCents: order.amount_cents,
    status: order.payment_status, checkedAt: order.checked_at, creditedAt: order.credited_at,
    createdAt: order.created_at, consumptionStarted: !!order.consume_started_at,
    purchaseExpired,
    paymentUrl: !purchaseExpired && ['UNKNOWN', 'PENDING'].includes(order.payment_status) ? purchaseLink(order.purchase_url) : null,
  };
}

function readOrder(env, accountId, id) {
  return env.DB.prepare('SELECT * FROM opcpay_recharges WHERE account_id = ? AND id = ?').bind(accountId, id).first();
}

async function panel(env, accountId, client) {
  const [rows, { flags, plans, catalogStatus }] = await Promise.all([
    env.DB.prepare('SELECT * FROM opcpay_recharges WHERE account_id = ? ORDER BY (credited_at IS NULL) DESC, created_at DESC, rowid DESC LIMIT 25').bind(accountId).all(),
    catalogFor(client),
  ]);
  return reply({ plans, catalogStatus, canQuery: flags.transaction_query === true, canRedeem: flags.consumption === true && flags.entitlement_query === true, orders: rows.results.map(publicOrder) });
}

const activeOrderFilter = `account_id = ? AND credited_at IS NULL AND payment_status != 'REFUNDED'
  AND (purchase_expires_at IS NULL OR purchase_expires_at > ? OR payment_status = 'PAID' OR consume_started_at IS NOT NULL)`;

async function checkout(request, env, client, accountId) {
  const input = await request.json().catch(() => null);
  if (typeof input?.skuId !== 'string' || !input.skuId || input.skuId.length > 128 || typeof input.actionId !== 'string' || !uuid.test(input.actionId) ||
      Object.keys(input).some(key => !['skuId', 'actionId'].includes(key))) return reply({ error: '购买请求不正确。' }, 400);
  const byAction = () => env.DB.prepare('SELECT * FROM opcpay_recharges WHERE account_id = ? AND action_id = ?').bind(accountId, input.actionId).first();
  const now = new Date().toISOString();
  const activeOrder = () => env.DB.prepare(`SELECT * FROM opcpay_recharges WHERE ${activeOrderFilter} ORDER BY created_at DESC, rowid DESC LIMIT 1`).bind(accountId, now).first();
  let order = await byAction();
  if (order && order.sku_id !== input.skuId) return reply({ error: '原购买编号已绑定其他套餐。' }, 409);
  order ??= await activeOrder();
  if (order) return resumeCheckout(env, client, null, order);

  const { flags, plans, catalogStatus } = await catalogFor(client);
  if (catalogStatus === 'unavailable') return reply({ error: '暂时无法连接支付服务，请重试。' }, 503);
  const plan = plans.find(sku => sku.id === input.skuId);
  if (!plan) return reply({ error: '套餐已变化或暂不可购买，请刷新。' }, 409);
  const id = crypto.randomUUID();
  const callback = `${callbackOrigin}/?panel=recharge&opcpay_order=${id}`;
  await env.DB.prepare(`INSERT INTO opcpay_recharges
    (id, account_id, action_id, sku_id, price_version, amount_cents, points, callback_url, consumption_reason)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM opcpay_recharges WHERE ${activeOrderFilter})
    ON CONFLICT (account_id, action_id) DO NOTHING`)
    .bind(id, accountId, input.actionId, plan.id, plan.version, plan.amountCents, plan.points, callback, consumptionReason, accountId, now).run();
  order = await byAction() || await activeOrder();
  if (!order) return reply({ error: '订单状态已更新，请重试。' }, 409);
  if (order.action_id === input.actionId && order.sku_id !== input.skuId) return reply({ error: '原购买编号已绑定其他套餐。' }, 409);
  return resumeCheckout(env, client, flags, order, order.id !== id, order.id === id ? plan : null);
}

async function resumeCheckout(env, client, flags, order, recovery = true, plan = null) {
  if (order.purchase_url || publicOrder(order).purchaseExpired || !['UNKNOWN', 'PENDING'].includes(order.payment_status)) return purchaseReply(order);
  flags ??= await capabilities(client);
  if (flags.purchase_entry !== true) return reply({ error: '购买入口暂不可用。', order: publicOrder(order) }, 503);
  let purchase, record;
  try {
    if (recovery && flags.purchase_request_query === true) {
      record = await client.purchaseQuery(order.account_id, order.id).catch(error => {
        if (error.status === 404) return null;
        throw error;
      });
      if (record && (record.user_id !== order.account_id || record.idempotency_key !== order.id || record.sku_id !== order.sku_id)) {
        return reply({ error: '原订单记录与套餐不符，请联系支持。', order: publicOrder(order) }, 409);
      }
      if (record?.status === 'EXPIRED' || record?.response?.status === 'EXPIRED') purchase = { status: 'EXPIRED', idempotency_key: order.id };
      else if (record?.response?.status === 'READY') purchase = record.response;
    }
    purchase ??= await client.purchase({ userId: order.account_id, idempotencyKey: order.id, skuId: order.sku_id, callbackURL: order.callback_url });
  } catch (error) {
    console.warn(JSON.stringify({ event: 'opcpay_purchase_unavailable', reason: 'provider_error', status: Number.isInteger(error?.status) ? error.status : null }));
    return reply({ error: '购买入口暂未确认，请重试原订单。', order: publicOrder(order) }, 503);
  }
  if (purchase.status === 'EXPIRED' && purchase.idempotency_key === order.id) {
    await env.DB.prepare('UPDATE opcpay_recharges SET purchase_expires_at = ? WHERE id = ? AND purchase_url IS NULL AND purchase_expires_at IS NULL')
      .bind(new Date().toISOString(), order.id).run();
    return reply({ order: publicOrder(await readOrder(env, order.account_id, order.id)) });
  }
  const url = purchase.status === 'READY' && purchase.idempotency_key === order.id ? purchaseLink(purchase.purchase_url) : null;
  const expires = purchaseExpiry(purchase.expire_time || record?.expires_at);
  const locked = purchase.charging_option == null && url
    ? plan || checkoutPlans(await client.product(), flags).find(sku => sku.id === order.sku_id)
    : pointSku(purchase.charging_option);
  if (!url || Number.isNaN(expires) || locked?.id !== order.sku_id || locked.version !== order.price_version ||
      locked.points !== order.points || locked.amountCents !== order.amount_cents) {
    const reason = !url ? 'entry_invalid' : Number.isNaN(expires) ? 'expiry_invalid' : 'sku_mismatch';
    console.warn(JSON.stringify({ event: 'opcpay_purchase_unavailable', reason,
      ready: purchase.status === 'READY', referenceMatches: purchase.idempotency_key === order.id,
      hasQr: typeof purchase.purchase_qr_code === 'string' && !!purchase.purchase_qr_code,
      hasSnapshot: purchase.charging_option != null }));
    return reply({ error: '暂未取得与原套餐一致的购买入口，请重试原订单。', order: publicOrder(order) }, 503);
  }
  await env.DB.prepare('UPDATE opcpay_recharges SET purchase_url = ?, purchase_expires_at = ? WHERE id = ? AND purchase_url IS NULL')
    .bind(url, expires == null ? null : new Date(expires).toISOString(), order.id).run();
  return purchaseReply(await readOrder(env, order.account_id, order.id));
}

const qrSvg = url => QRCode.toString(url, { type: 'svg', width: 240, margin: 4 });

async function purchaseReply(order) {
  const result = publicOrder(order);
  const svg = result.paymentUrl ? await qrSvg(result.paymentUrl).catch(() => null) : null;
  return reply({ order: result, ...(svg ? { qrImage: 'data:image/svg+xml;base64,' + btoa(svg) } : {}) });
}

async function paymentQr(env, accountId, id) {
  const order = await readOrder(env, accountId, id);
  const url = order && publicOrder(order).paymentUrl;
  if (!url) return reply({ error: '此订单暂无可用二维码。' }, 404);
  const svg = await qrSvg(url);
  return new Response(svg, { headers: {
    'content-type': 'image/svg+xml; charset=utf-8', 'cache-control': 'private, no-store',
    'content-security-policy': "default-src 'none'; sandbox", 'x-content-type-options': 'nosniff',
  } });
}

async function checkPayment(env, client, flags, order) {
  if (flags.transaction_query !== true) return order;
  const now = Date.now();
  const slot = await env.DB.prepare('UPDATE opcpay_recharges SET queried_at_ms = ? WHERE id = ? AND queried_at_ms <= ?')
    .bind(now, order.id, now - queryIntervalMs).run();
  if (!slot.meta.changes) return readOrder(env, order.account_id, order.id);

  const state = await client.transactionQuery({ user_id: order.account_id, idempotency_key: order.id });
  const checked = Date.parse(state.checked_at);
  if (state.user_id !== order.account_id || state.idempotency_key !== order.id) throw new Error('OPCPay order mismatch');
  if (!Number.isFinite(checked) || state.status_source !== 'ALIPAY_PURCHASE_QUERY_V3' ||
      !['PAID', 'REFUNDED', 'PENDING'].includes(state.status)) return readOrder(env, order.account_id, order.id);
  const tradeNo = ['PAID', 'REFUNDED'].includes(state.status) ? state.trade_no : null;
  if (state.status !== 'PENDING' && (typeof tradeNo !== 'string' || !tradeNo || tradeNo.length > 128)) throw new Error('OPCPay trade missing');
  await env.DB.prepare(`UPDATE opcpay_recharges SET payment_status = ?, trade_no = COALESCE(?, trade_no), checked_at = ?
    WHERE id = ? AND (checked_at IS NULL OR checked_at < ?)
    AND (trade_no IS NULL OR trade_no = ?)
    AND payment_status != 'REFUNDED'`)
    .bind(state.status, tradeNo, new Date(checked).toISOString(), order.id, new Date(checked).toISOString(), tradeNo).run();
  return readOrder(env, order.account_id, order.id);
}

function consumptionMatches(result, number, order) {
  return result?.status === 'SUCCEEDED' && result.confirmed === true &&
    result.idempotency_key === number && result.quota_unit === 'POINT' && result.consumed === order.points;
}

async function redeem(env, client, flags, order, paymentChecked = false) {
  if (order.credited_at) return reply({ order: publicOrder(order) });
  if (flags.consumption !== true) return reply({ error: '积分核销暂不可用。' }, 503);
  const number = 'recharge-' + order.id;
  let result;
  if (order.consume_started_at) {
    result = await client.consumption(order.account_id, number).catch(error => {
      if (error.status !== 404) throw error;
      return null;
    });
  }
  if (!consumptionMatches(result, number, order)) {
    if (result && (result.idempotency_key !== number || result.status === 'SUCCEEDED')) {
      return reply({ error: '积分核销凭证与订单不符，请联系支持。', order: publicOrder(order) }, 409);
    }
    if (result?.status === 'FAILED') return reply({ error: '原订单的积分核销失败，请联系支持。', order: publicOrder(order) }, 409);
    if (result?.status === 'PROCESSING') return reply({ order: publicOrder(order) }, 202);
    if (flags.transaction_query !== true || flags.entitlement_query !== true) return reply({ error: '支付或权益查询暂不可用。' }, 503);
    if (!paymentChecked) order = await checkPayment(env, client, flags, order);
    if (order.credited_at) return reply({ order: publicOrder(order) });
    if (order.payment_status !== 'PAID' || !order.trade_no || !order.purchase_url) return reply({ error: '订单尚未确认付款。', order: publicOrder(order) }, 409);
    if (!order.consume_started_at) {
      const access = await client.access(order.account_id, order.points);
      if (access.access_granted !== true || access.requires_consumption !== true || access.quota_unit !== 'POINT' ||
          !Number.isSafeInteger(access.remaining) || access.remaining < order.points) {
        if (paymentChecked && access.quota_unit === 'POINT' && Number.isSafeInteger(access.remaining) && access.remaining < order.points) {
          return reply({ order: publicOrder(order) }, 202);
        }
        return reply({ error: '可用积分不足，请核对支付宝权益后重试。', order: publicOrder(order) }, 409);
      }
      await env.DB.prepare("UPDATE opcpay_recharges SET consume_started_at = CURRENT_TIMESTAMP WHERE id = ? AND payment_status = 'PAID' AND consume_started_at IS NULL").bind(order.id).run();
      order = await readOrder(env, order.account_id, order.id);
      if (order.credited_at) return reply({ order: publicOrder(order) });
      if (!order.consume_started_at || order.payment_status !== 'PAID') return reply({ error: '订单状态已变化，请重新查询。', order: publicOrder(order) }, 409);
    }
    result = await client.consume({ userId: order.account_id, idempotencyKey: number, amount: order.points, reason: order.consumption_reason });
  }
  if (!consumptionMatches(result, number, order)) {
    const retryable = result?.idempotency_key === number && ['UNKNOWN', 'PROCESSING'].includes(result.status);
    return reply({ order: publicOrder(order), ...(retryable ? {} : { error: '积分核销未确认，请重试原订单或联系支持。' }) }, retryable ? 202 : 409);
  }
  const receipt = typeof result.consume_order_id === 'string' && result.consume_order_id ? result.consume_order_id : null;
  await env.DB.prepare('UPDATE opcpay_recharges SET consume_order_id = ?, credited_at = CURRENT_TIMESTAMP WHERE id = ? AND credited_at IS NULL')
    .bind(receipt, order.id).run();
  return reply({ order: publicOrder(await readOrder(env, order.account_id, order.id)) });
}

export async function handleOpcpayRoute(request, env, path, sessionFor) {
  const match = path.match(/^\/billing\/opcpay\/orders\/([0-9a-f-]+)\/(resume|status|redeem|settle)$/i);
  const qr = request.method === 'GET' && path.match(/^\/billing\/opcpay\/orders\/([0-9a-f-]+)\/qr$/i);
  const view = path === route && request.method === 'GET';
  const buy = path === route + '/checkout' && request.method === 'POST';
  if (!view && !buy && !(qr && uuid.test(qr[1])) && !(match && uuid.test(match[1]) && request.method === 'POST')) return null;
  if (request.method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin) return reply({ error: '请求来源不正确。' }, 403);
  const session = await sessionFor(request, env);
  if (!session) return reply({ error: '请先登录。' }, 401);
  try {
    if (qr) return await paymentQr(env, session.sub, qr[1]);
    const client = clientFor(env);
    if (view) return await panel(env, session.sub, client);
    if (!client) return reply({ error: '充值服务暂不可用，请稍后重试。' }, 503);
    if (buy) return await checkout(request, env, client, session.sub);
    const order = await readOrder(env, session.sub, match[1]);
    if (!order) return reply({ error: '订单不存在。' }, 404);
    if (match[2] === 'resume') return await resumeCheckout(env, client, null, order);
    if (order.credited_at || order.payment_status === 'REFUNDED') return reply({ order: publicOrder(order) });
    const flags = await capabilities(client);
    if (match[2] === 'redeem') return await redeem(env, client, flags, order);
    if (flags.transaction_query !== true) return reply({ error: '订单查询暂不可用。' }, 503);
    const checked = await checkPayment(env, client, flags, order);
    if (match[2] === 'settle' && checked.payment_status === 'PAID') return await redeem(env, client, flags, checked, true);
    return reply({ order: publicOrder(checked) });
  } catch {
    return reply({ error: '一人付操作暂未确认，请重试原订单。' }, 503);
  }
}

export async function opcpayAdminPlan(env) {
  const { plans, reason } = await catalogFor(clientFor(env));
  return reply({ provider: 'opcpay', paymentAvailable: plans.length > 0, plans, ...(reason ? { reason } : {}) });
}
