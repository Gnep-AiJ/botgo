import assert from 'node:assert/strict';
import { createShopRuntime } from './fixtures/shop-runtime.mjs';

const runtime = await createShopRuntime();
const origin = 'https://botgo.test';
const call = (path, cookie, body, requestOrigin = origin) => runtime.pagesFetch(new Request(origin + '/api' + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: {
    ...(cookie ? { cookie } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json', origin: requestOrigin }),
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));
async function login(email) {
  assert.equal((await call('/auth/request-login-code', null, { email })).status, 202);
  const response = await call('/auth/login', null, { email, code: runtime.codes.get(email) });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
const balance = () => runtime.db.prepare("SELECT credit_balance FROM accounts WHERE id = 'fixture-a'").get().credit_balance;
const payload = (productId = 'FIXTURE-PLUS', amountCents = 14000) => ({ productId, amountCents, actionId: crypto.randomUUID(), accepted: true });
const created = async response => (await response.json()).order;

try {
  assert.equal((await call('/shop/config')).status, 200);
  const catalogResponse = await call('/shop/catalog');
  assert.equal(catalogResponse.status, 200);
  const { products } = await catalogResponse.json();
  assert.deepEqual(products.map(p => [p.name, p.priceCents]), [
    ['ChatGPT Plus', 14000], ['ChatGPT Pro 10×', 70000], ['ChatGPT Pro 20×', 140000],
    ['ChatGPT Pro 50×', 350000], ['ChatGPT Pro 99×', null], ['ChatGPT Go', 5600],
  ]);
  assert.equal(products[1].id, 'FIXTURE-PRO-ALT');
  assert.equal(products[1].available, true);
  assert.equal(products[2].available, false);
  assert.equal(products[4].available, false);
  assert.deepEqual(Object.keys(products[0]).sort(), ['available', 'id', 'name', 'priceCents', 'stock', 'tier']);
  assert.equal((await call('/shop/orders')).status, 401);
  assert.equal((await call('/shop/cards/check', null, { code: 'NCGPT-FIXTURE-1' })).status, 401);
  const buyer = await login('a@example.invalid');
  const admin = await login('b@example.invalid');
  assert.match(runtime.emails[0].html, /邮箱验证码/);
  assert.match(runtime.emails[0].html, new RegExp(runtime.codes.get('a@example.invalid')));
  runtime.env.ADMIN_EMAIL = 'b@example.invalid';
  runtime.upstream.catalogOffline = true;
  const failures = await Promise.all([call('/shop/catalog'), call('/shop/catalog')]);
  for (const failure of failures) {
    assert.equal(failure.status, 503);
    assert.equal((await failure.json()).support, true);
  }
  await runtime.settle();
  assert.equal(runtime.emails.length, 3);
  assert.equal(runtime.emails[2].recipient, 'b@example.invalid');
  assert.match(runtime.emails[2].html, /商品目录读取异常/);
  assert.doesNotMatch(runtime.emails[2].text, /raw upstream|fixture-yunshu|a@example/);
  runtime.upstream.catalogOffline = false;
  assert.equal((await call('/admin/shop/orders', buyer)).status, 403);
  assert.equal((await call('/shop/orders', buyer, payload(), 'https://outside.invalid')).status, 403);
  assert.equal((await call('/shop/orders', buyer, { ...payload(), accepted: false })).status, 400);

  runtime.db.exec("UPDATE accounts SET credit_balance = 14100, credit_remainder_micros = 25, billing_reserved_micros = 1010000 WHERE id = 'fixture-a'");
  assert.equal((await (await call('/shop/orders', buyer)).json()).availableCents, 13999);
  const insufficient = await call('/shop/orders', buyer, payload());
  assert.equal(insufficient.status, 402);
  assert.equal((await insufficient.json()).support, undefined);
  await runtime.settle();
  assert.equal(runtime.emails.length, 3);
  assert.equal(balance(), 14100);
  runtime.db.exec("UPDATE accounts SET credit_balance = 14000, billing_reserved_micros = 0 WHERE id = 'fixture-a'");
  assert.equal((await call('/shop/orders', buyer, payload('FIXTURE-PLUS', 1))).status, 409);
  assert.equal((await call('/shop/orders', buyer, payload('FIXTURE-PLUS', 11900))).status, 409);
  runtime.upstream.stock['FIXTURE-PLUS'] = '0';
  const stockout = await call('/shop/orders', buyer, payload());
  assert.equal(stockout.status, 409);
  assert.equal((await stockout.json()).support, true);
  runtime.upstream.stock['FIXTURE-PLUS'] = '20';
  runtime.upstream.prices['FIXTURE-PLUS'] = '140.01';
  assert.equal((await call('/shop/orders', buyer, payload())).status, 409);
  runtime.upstream.prices['FIXTURE-PLUS'] = '107.90';
  assert.equal(balance(), 14000);

  const input = payload();
  const attempts = await Promise.all([call('/shop/orders', buyer, input), call('/shop/orders', buyer, input)]);
  assert.deepEqual(attempts.map(response => response.status).sort(), [200, 201]);
  const [order, replay] = await Promise.all(attempts.map(created));
  assert.deepEqual(order, replay);
  assert.equal(order.state, 'paid');
  assert.equal(order.productName, 'ChatGPT Plus');
  const buyerOrders = await (await call('/shop/orders', buyer)).json();
  const staffOrders = await (await call('/admin/shop/orders', admin)).json();
  assert.equal(buyerOrders.orders[0].productName, 'ChatGPT Plus');
  assert.equal(staffOrders.orders[0].productName, 'ChatGPT Plus · 菲律宾区');
  assert.equal(balance(), 0);
  assert.equal(runtime.db.prepare("SELECT credit_remainder_micros FROM accounts WHERE id = 'fixture-a'").get().credit_remainder_micros, 25);
  assert.equal((await call('/shop/orders', buyer, { ...input, productId: 'FIXTURE-GO' })).status, 409);
  const cardPath = '/shop/orders/' + order.id + '/card';
  assert.equal((await call(cardPath, buyer)).status, 404);
  const adminPath = '/admin/shop/orders/' + order.id;
  assert.equal((await call(adminPath + '/claim', buyer, {})).status, 403);
  assert.equal((await call(adminPath + '/deliver', admin, { supplierOrder: 'FIXTURE-TRADE', code: 'NCGPT-FIXTURE-1' })).status, 409);
  assert.equal((await call(adminPath + '/claim', admin, {})).status, 200);
  assert.equal((await call(adminPath + '/claim', admin, {})).status, 200);
  const delivery = { supplierOrder: 'FIXTURE-TRADE', code: 'NCGPT-FIXTURE-1' };
  assert.equal((await call(adminPath + '/deliver', admin, delivery)).status, 200);
  assert.equal((await call(adminPath + '/deliver', admin, delivery)).status, 200);
  assert.equal((await call(adminPath + '/refund', admin, { confirmed: true })).status, 409);
  assert.equal((await call(cardPath, admin)).status, 404);
  const card = await call(cardPath, buyer);
  assert.match(card.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await card.json(), { code: delivery.code });
  const stored = runtime.db.prepare('SELECT card_ciphertext, card_fingerprint FROM shop_orders WHERE id = ?').get(order.id);
  assert.equal(stored.card_fingerprint.length, 64);
  assert.notEqual(stored.card_ciphertext, delivery.code);
  assert.doesNotMatch(JSON.stringify(await (await call('/shop/orders', buyer)).json()), /NCGPT-|fingerprint|ciphertext/);
  assert.doesNotMatch(JSON.stringify(await (await call('/admin/shop/orders', admin)).json()), /NCGPT-|fingerprint|ciphertext/);

  runtime.db.exec("UPDATE accounts SET credit_balance = 5600 WHERE id = 'fixture-a'");
  const concurrent = await Promise.all([call('/shop/orders', buyer, payload('FIXTURE-GO', 5600)), call('/shop/orders', buyer, payload('FIXTURE-GO', 5600))]);
  assert.deepEqual(concurrent.map(response => response.status).sort(), [201, 402]);
  const nextOrder = await created(concurrent.find(response => response.status === 201));
  const allBuyerOrders = await (await call('/shop/orders', buyer)).json();
  assert.deepEqual(allBuyerOrders.orders.map(row => row.productName), ['ChatGPT Go', 'ChatGPT Plus']);
  const nextPath = '/admin/shop/orders/' + nextOrder.id;
  assert.equal(balance(), 0);
  assert.equal((await call(nextPath + '/claim', admin, {})).status, 200);
  assert.equal((await call(nextPath + '/deliver', admin, { supplierOrder: 'SECOND-TRADE', code: delivery.code })).status, 409);
  assert.equal((await call(nextPath + '/refund', admin, { confirmed: true })).status, 200);
  assert.equal((await call(nextPath + '/refund', admin, { confirmed: true })).status, 200);
  assert.equal(balance(), 5600);

  const check = () => call('/shop/cards/check', buyer, { code: delivery.code });
  assert.equal((await call('/shop/cards/check', buyer, { code: delivery.code, unexpected: 'fixture' })).status, 400);
  assert.deepEqual(await (await check()).json(), { status: 'valid' });
  assert.equal(runtime.upstream.calls.at(-1), 'yunshutoken.com:check');
  runtime.env.YUNSHU_REDEEM_API_KEY = 'fixture-agent-key';
  runtime.upstream.cardStatus = 'processing';
  assert.deepEqual(await (await check()).json(), { status: 'processing' });
  assert.equal(runtime.upstream.calls.at(-1), 'redeem.yunpaycard.com:check');
  runtime.upstream.cardStatus = 'used';
  assert.deepEqual(await (await check()).json(), { status: 'used' });
  assert.deepEqual(await (await call('/shop/cards/check', buyer, { code: 'ZC-FIXTURE' })).json(), { status: 'used' });
  assert.equal(runtime.upstream.calls.at(-1), 'yunshutoken.com:check');
  runtime.db.prepare("UPDATE shop_card_checks SET window_minute = ?, attempts = 8 WHERE account_id = 'fixture-a'").run(Math.floor(Date.now() / 60_000));
  assert.equal((await check()).status, 429);

  const shopKey = runtime.env.YUNSHU_SHOP_API_KEY;
  delete runtime.env.YUNSHU_SHOP_API_KEY;
  assert.equal((await call('/shop/config')).status, 404);
  assert.equal((await call('/shop/orders', buyer, input)).status, 404);
  runtime.env.YUNSHU_SHOP_API_KEY = shopKey;
  runtime.env.BOTGO_SHOP_ENABLED = '0';
  assert.equal((await call('/shop/config')).status, 404);
  assert.equal((await call('/shop/orders', buyer, input)).status, 404);
  assert.equal((await call('/admin/shop/orders', admin)).status, 404);
  assert.equal(runtime.upstream.calls.some(path => /:(?:order|redeem|confirm)$/.test(path)), false);
  console.log('GPT shop passed: Pages and Worker routing, catalog, atomic wallet debit/refund, replay protection, ownership, encrypted card delivery and card checks.');
} finally {
  await runtime.settle();
  runtime.close();
}
