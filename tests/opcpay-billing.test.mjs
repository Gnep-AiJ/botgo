import assert from 'node:assert/strict';
import { createWebChatRuntime } from './fixtures/web-chat-runtime.mjs';
import { opcpayAdminPlan } from '../worker/src/opcpay-routes.js';

const runtime = await createWebChatRuntime();
const fixtureKey = 'isolated-opcpay-key';
const vendorFetch = globalThis.fetch;
const sku = {
  sku_id: 'test-points', display_name: '测试积分', billing_mode: 'QUANTITY', quota_unit: 'POINT',
  entitlement_rule: 'QUOTA', price: '10.00', currency: 'CNY', price_version: 1, quota_amount: 10,
};
const flags = { purchase_entry: true, entitlement_query: true, consumption: true, transaction_query: true };
const purchaseAttempts = [];
const consumeAttempts = [];
const consumptions = new Map();
let remaining = 0;
let payment = 'UNKNOWN';
let tradeNo = 'unique-test-trade';
let checkedAt = Date.now();
let transactionQueries = 0;
let losePurchaseResponse = true;
let loseConsumeResponse = true;
let badReceipt = false;
let providerFailure = 0;
let calls = [];
let rejectSnapshot = false;
const deepLink = 'alipays://platformapi/startapp?appId=20000067&url=https%3A%2F%2Fqr.alipay.com%2Ffixture';
let omitPurchaseSnapshot = false;
const orderPath = id => '/billing/opcpay/orders/' + id;
const request = (path, cookie, body, origin = 'https://botgo.test') => runtime.pagesFetch(new Request('https://botgo.test/api' + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { origin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));
async function login(email) {
  await request('/auth/request-login-code', undefined, { email });
  const response = await request('/auth/login', undefined, { email, code: runtime.codes.get(email) });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
const balance = () => runtime.db.prepare("SELECT credit_balance FROM accounts WHERE id = 'fixture-a'").get().credit_balance;
const unthrottle = () => runtime.db.exec('UPDATE opcpay_recharges SET queried_at_ms = 0');

globalThis.fetch = async (url, options) => {
  if (!String(url).startsWith('https://ai6666.com/opcpay/api/pay/v1/')) return vendorFetch(url, options);
  assert.equal(options.redirect, 'manual', 'workerd rejects the Fetch error redirect mode');
  assert.equal(new Headers(options.headers).get('authorization'), 'Bearer ' + fixtureKey);
  const path = new URL(url).pathname.replace('/opcpay/api/pay/v1/', '');
  calls.push(path);
  const body = options.body ? JSON.parse(options.body) : null;
  if (path === 'capabilities') {
    if (providerFailure === 302) return new Response(null, { status: 302, headers: { location: 'https://other.test/' } });
    if (providerFailure) return Response.json({ error: 'fixture provider failure' }, { status: providerFailure });
    return Response.json({ provider_configured: true, capabilities: flags });
  }
  if (path === 'product') return Response.json({
    capability_status: 'ENABLED', billing_mode: 'QUANTITY', quota_unit: 'POINT', charging_options: [
      sku, { ...sku, sku_id: 'wrong-ratio', price: '9.00' }, { ...sku, sku_id: 'wrong-unit', quota_unit: 'COUNT' },
    ],
  });
  assert.equal(body.user_id, 'fixture-a');
  if (path === 'access') return Response.json({
    remaining, quota_unit: 'POINT', requires_consumption: true, access_granted: remaining >= body.amount,
  });
  if (path === 'purchase') {
    purchaseAttempts.push(body);
    assert.equal(body.sku_id, sku.sku_id);
    assert.equal(body.callback_url, 'https://botgo.win/?panel=recharge&opcpay_order=' + body.idempotency_key);
    assert.ok(runtime.db.prepare('SELECT 1 FROM opcpay_recharges WHERE id = ?').get(body.idempotency_key));
    if (losePurchaseResponse) {
      losePurchaseResponse = false;
      throw new TypeError('Lost purchase response');
    }
    return Response.json({
      status: 'READY', idempotency_key: body.idempotency_key, purchase_url: deepLink,
      expire_time: omitPurchaseSnapshot ? '2099-11-13T10:00:00+08:00' : '2099-11-13 10:00:00',
      ...(omitPurchaseSnapshot ? {} : { charging_option: rejectSnapshot ? { ...sku, price_version: 2 } : sku }),
    });
  }
  if (path === 'transactions/query') {
    transactionQueries++;
    return Response.json({
      user_id: body.user_id, idempotency_key: body.idempotency_key, status: payment,
      checked_at: payment === 'UNKNOWN' ? null : new Date(checkedAt).toISOString(),
      status_source: payment === 'UNKNOWN' ? null : 'ALIPAY_PURCHASE_QUERY_V3',
      trade_no: ['PAID', 'REFUNDED'].includes(payment) ? tradeNo : null,
    });
  }
  if (path === 'consumption') {
    const result = consumptions.get(body.idempotency_key);
    return result ? Response.json(result) : Response.json({ error_code: 'NOT_FOUND' }, { status: 404 });
  }
  assert.equal(path, 'consume');
  consumeAttempts.push(body);
  const saved = runtime.db.prepare('SELECT consume_started_at, points, consumption_reason FROM opcpay_recharges WHERE id = ?')
    .get(body.idempotency_key.slice('recharge-'.length));
  assert.ok(saved.consume_started_at, 'the debit intent is durable before the vendor write');
  assert.equal(body.amount, saved.points);
  assert.equal(body.reason, saved.consumption_reason);
  if (!consumptions.has(body.idempotency_key)) {
    remaining -= body.amount;
    consumptions.set(body.idempotency_key, {
      status: 'SUCCEEDED', confirmed: true, quota_unit: badReceipt ? 'COUNT' : 'POINT', consumed: body.amount,
      idempotency_key: body.idempotency_key, consume_order_id: 'consume-' + body.idempotency_key,
    });
  }
  if (loseConsumeResponse) {
    loseConsumeResponse = false;
    throw new TypeError('Lost consumption response');
  }
  return Response.json(consumptions.get(body.idempotency_key));
};

try {
  const a = await login('a@example.invalid');
  const b = await login('b@example.invalid');
  const start = balance();
  assert.equal((await request('/billing/opcpay')).status, 401);
  assert.equal((await request('/billing/checkout', a, {})).status, 410);
  assert.deepEqual((await (await request('/billing/opcpay', a)).json()).plans, []);
  runtime.env.opcpay_api_key = ' ' + fixtureKey + ' ';
  providerFailure = 401;
  assert.equal((await (await request('/billing/opcpay', a)).json()).catalogStatus, 'unavailable');
  assert.equal((await (await opcpayAdminPlan(runtime.env)).json()).reason, 'provider_auth');
  providerFailure = 302;
  assert.equal((await (await opcpayAdminPlan(runtime.env)).json()).reason, 'provider_response');
  providerFailure = 0;
  flags.purchase_entry = false;
  assert.equal((await (await request('/billing/opcpay', a)).json()).catalogStatus, 'closed');
  flags.purchase_entry = true;
  calls = [];
  const available = await (await request('/billing/opcpay', a)).json();
  assert.equal(available.catalogStatus, 'ready');
  assert.deepEqual(calls.sort(), ['capabilities', 'product'], 'loading the catalogue must not query account entitlement');
  assert.deepEqual(available.plans.map(plan => plan.id), [sku.sku_id]);
  assert.ok(!JSON.stringify(available).includes(fixtureKey));
  const body = { skuId: sku.sku_id, actionId: crypto.randomUUID() };
  assert.equal((await request('/billing/opcpay/checkout', a, body, 'https://other.test')).status, 403);
  assert.equal((await request('/billing/opcpay/checkout', a, { ...body, userId: 'fixture-b', amount: 1 })).status, 400);
  assert.equal((await request('/billing/opcpay/checkout', a, { ...body, skuId: 'wrong-ratio' })).status, 409);

  const lost = await request('/billing/opcpay/checkout', a, body);
  assert.equal(lost.status, 503);
  const { order: pending } = await lost.json();
  const id = pending.id;
  assert.equal((await request(orderPath(id) + '/resume', b, {})).status, 404);
  const ready = await (await request('/billing/opcpay/checkout', a, body)).json();
  assert.equal(ready.order.id, id);
  assert.equal(ready.order.status, 'UNKNOWN');
  assert.equal(ready.order.paymentUrl, deepLink);
  assert.match(ready.qrImage, /^data:image\/svg\+xml;base64,/);
  assert.deepEqual(purchaseAttempts[0], purchaseAttempts[1]);
  assert.equal(balance(), start);
  calls = [];
  const duplicate = await (await request('/billing/opcpay/checkout', a, { ...body, actionId: crypto.randomUUID() })).json();
  assert.equal(duplicate.order.id, id, 'another tab reuses the open order even with a fresh action ID');
  assert.deepEqual(calls, [], 'a saved link and QR do not need provider calls');
  assert.equal((await request(orderPath(id) + '/qr')).status, 401);
  assert.equal((await request(orderPath(id) + '/qr', b)).status, 404);
  const qr = await request(orderPath(id) + '/qr', a);
  assert.equal(qr.status, 200);
  assert.match(qr.headers.get('content-type'), /^image\/svg\+xml/);
  assert.equal(qr.headers.get('cache-control'), 'private, no-store');
  assert.match(await qr.text(), /^<svg/);

  assert.equal((await request(orderPath(id) + '/redeem', a, { paid: true })).status, 409);
  assert.equal(consumeAttempts.length, 0, 'browser payment assertions never prove a charge');
  const count = transactionQueries;
  assert.equal((await (await request(orderPath(id) + '/settle', a, {})).json()).order.creditedAt, null);
  assert.equal(transactionQueries, count, 'provider queries are throttled');

  payment = 'PAID';
  unthrottle();
  const paid = await (await request(orderPath(id) + '/status', a, {})).json();
  assert.equal(paid.order.status, 'PAID');
  assert.equal(paid.order.checkedAt, new Date(checkedAt).toISOString());
  assert.equal((await request(orderPath(id) + '/redeem', a, {})).status, 409, 'verified payment without usable points must not credit');
  const waitingForPoints = await request(orderPath(id) + '/settle', a, {});
  assert.equal(waitingForPoints.status, 202, 'the UI can continue polling while paid points are not yet available');
  assert.equal((await waitingForPoints.json()).order.creditedAt, null);
  assert.equal(balance(), start);
  remaining = 10;
  assert.equal((await request(orderPath(id) + '/redeem', a, {})).status, 503);
  assert.equal(remaining, 0);
  assert.equal(balance(), start, 'no credit on a lost vendor response');
  const recovered = await Promise.all([
    request(orderPath(id) + '/redeem', a, {}), request(orderPath(id) + '/redeem', a, {}),
  ]);
  for (const response of recovered) {
    assert.equal(response.status, 200);
    assert.ok((await response.json()).order.creditedAt);
  }
  assert.equal(balance(), start + 1000);
  assert.equal(consumeAttempts.length, 1, 'recovery reads the original debit');
  assert.equal((await request(orderPath(id) + '/qr', a)).status, 404, 'credited orders must not render a payment QR');

  omitPurchaseSnapshot = true;
  calls = [];
  const second = (await (await request('/billing/opcpay/checkout', a, { ...body, actionId: crypto.randomUUID() })).json()).order;
  assert.notEqual(second.id, id, 'a completed order allows another top-up');
  assert.equal(second.paymentUrl, deepLink, 'optional missing snapshot is verified against the current catalogue');
  assert.deepEqual(calls, ['capabilities', 'product', 'purchase'], 'creating the order reuses the validated catalogue');
  assert.equal((await request(orderPath(second.id) + '/status', a, {})).status, 503, 'trade numbers may only credit one order');
  checkedAt++;
  tradeNo = 'another-test-trade';
  unthrottle();
  remaining = 10;
  const next = await request(orderPath(second.id) + '/settle', a, {});
  assert.equal(next.status, 200);
  assert.ok((await next.json()).order.creditedAt);
  assert.equal(balance(), start + 2000);

  badReceipt = true;
  omitPurchaseSnapshot = false;
  const [third, sameThird] = await Promise.all(Array.from({ length: 2 }, () =>
    request('/billing/opcpay/checkout', a, { ...body, actionId: crypto.randomUUID() }).then(response => response.json())));
  assert.equal(third.order.id, sameThird.order.id, 'concurrent requests with different action IDs cannot create two local orders');
  checkedAt++;
  tradeNo = 'third-test-trade';
  unthrottle();
  remaining = 10;
  assert.equal((await request(orderPath(third.order.id) + '/settle', a, {})).status, 409, 'wrong-unit receipt must not credit');
  assert.equal(balance(), start + 2000);
  flags.transaction_query = false;
  assert.equal((await request(orderPath(third.order.id) + '/status', a, {})).status, 503);
  assert.equal((await request('/admin/billing/plan', a)).status, 403);
  console.log('OPCPay: session identity, provider plans, verified payment, order recovery, receipt validation, and exactly-once credit passed');
} finally {
  await runtime.settle();
  runtime.close();
}
