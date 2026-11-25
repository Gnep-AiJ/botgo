import { decryptSecret, encryptSecret } from './platform-admin.js';
import { ShopError, cardCode, checkCard, ensureAvailable, gptProducts } from './shop-yunshu.js';

const orderId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const missing = () => reply({ error: '接口不存在。' }, 404);

function reply(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'private, no-store' } });
}

async function readInput(request, fields) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    throw new ShopError('请求格式不正确。', 415);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new ShopError('请求不完整。', 400);
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_048) {
        await reader.cancel();
        throw new ShopError('请求内容过长。', 413);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  let input;
  try { input = JSON.parse(text + decoder.decode()); } catch { throw new ShopError('请求格式不正确。', 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !fields.includes(key))) {
    throw new ShopError('请求字段不正确。', 400);
  }
  return input;
}

function publicOrder(row, includeRegion = false) {
  return {
    id: row.id, productId: row.product_code,
    productName: includeRegion ? row.product_name : row.product_name.split(' · ', 1)[0],
    amountCents: row.amount_cents, state: row.state, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function previousOrder(env, accountId, actionId) {
  return env.DB.prepare('SELECT * FROM shop_orders WHERE account_id = ? AND action_id = ?').bind(accountId, actionId).first();
}

async function availableCents(env, accountId) {
  const row = await env.DB.prepare(`SELECT MAX(0, (credit_balance * 10000 + credit_remainder_micros - billing_reserved_micros) / 10000) AS cents
    FROM accounts WHERE id = ? AND status = 'active'`).bind(accountId).first();
  return row?.cents ?? 0;
}

function orderReceipt(row, input, status = 200) {
  if (row.product_code !== input.productId || row.amount_cents !== input.amountCents) {
    throw new ShopError('该操作已绑定另一笔订单，请查看我的订单。', 409);
  }
  return reply({ order: publicOrder(row) }, status);
}

async function checkout(request, env, accountId) {
  const input = await readInput(request, ['productId', 'amountCents', 'actionId', 'accepted']);
  if (typeof input.actionId !== 'string' || !orderId.test(input.actionId) ||
      typeof input.productId !== 'string' || !/^[A-Z0-9-]{1,64}$/.test(input.productId) ||
      !Number.isSafeInteger(input.amountCents) || input.amountCents < 1 || input.accepted !== true) {
    throw new ShopError('请确认商品、价格和购买须知。', 400);
  }
  const existing = await previousOrder(env, accountId, input.actionId);
  if (existing) return orderReceipt(existing, input);
  if (await availableCents(env, accountId) < input.amountCents) {
    // A concurrent retry may have just spent this balance for the same order.
    const confirmed = await previousOrder(env, accountId, input.actionId);
    if (confirmed) return orderReceipt(confirmed, input);
    throw new ShopError('BotGo 可用余额不足，请先充值。', 402);
  }
  const product = (await gptProducts(env)).find(item => item.id === input.productId);
  if (!product || product.priceCents === null) throw new ShopError('商品暂未开放购买。', 409);
  if (product.priceCents !== input.amountCents) throw new ShopError('商品价格已变化，请刷新后重试。', 409);
  await ensureAvailable(env, product);
  const result = await env.DB.prepare(`
    INSERT INTO shop_orders (id, account_id, action_id, product_code, product_name, amount_cents)
    SELECT ?, id, ?, ?, ?, ? FROM accounts
    WHERE id = ? AND status = 'active'
      AND credit_balance * 10000 + credit_remainder_micros - billing_reserved_micros >= ? * 10000
    ON CONFLICT(account_id, action_id) DO NOTHING
  `).bind(crypto.randomUUID(), input.actionId, product.id, product.name + ' · ' + product.region,
    product.priceCents, accountId, product.priceCents).run();
  const row = await previousOrder(env, accountId, input.actionId);
  if (!row) throw new ShopError('BotGo 可用余额不足，请先充值。', 402);
  return orderReceipt(row, input, result.meta.changes ? 201 : 200);
}

async function ordersFor(request, env, session, activeAdminFor) {
  const [rows, wallet, admin] = await Promise.all([
    env.DB.prepare('SELECT * FROM shop_orders WHERE account_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 30').bind(session.sub).all(),
    availableCents(env, session.sub),
    activeAdminFor(request, env),
  ]);
  return reply({ orders: rows.results.map(row => publicOrder(row)), availableCents: wallet, canManage: !!admin });
}

async function ownedCard(env, id, accountId) {
  const row = await env.DB.prepare("SELECT card_ciphertext, card_iv FROM shop_orders WHERE id = ? AND account_id = ? AND state = 'delivered'")
    .bind(id, accountId).first();
  if (!row) throw new ShopError('未找到已发货的订单。', 404);
  return reply({ code: await decryptSecret(row.card_ciphertext, row.card_iv, env) });
}

async function verifyCard(request, env, accountId) {
  const { code: raw } = await readInput(request, ['code']);
  const code = cardCode(raw);
  if (!code) throw new ShopError('请输入有效格式的卡密。', 400);
  const now = Math.floor(Date.now() / 60_000);
  const slot = await env.DB.prepare(`
    INSERT INTO shop_card_checks (account_id, window_minute, attempts) VALUES (?, ?, 1)
    ON CONFLICT(account_id) DO UPDATE SET window_minute = excluded.window_minute,
      attempts = CASE WHEN window_minute = excluded.window_minute THEN attempts + 1 ELSE 1 END
    WHERE window_minute <> excluded.window_minute OR attempts < 8
  `).bind(accountId, now).run();
  if (!slot.meta.changes) throw new ShopError('核验次数过多，请稍后再试。', 429);
  return reply(await checkCard(env, code));
}

async function adminOrders(env, admin) {
  const { results } = await env.DB.prepare(`
    SELECT o.id, o.product_code, o.product_name, o.amount_cents, o.state, o.created_at, o.updated_at,
      o.handled_by, o.supplier_order, a.email
    FROM shop_orders o JOIN accounts a ON a.id = o.account_id
    ORDER BY CASE WHEN o.state IN ('paid', 'purchasing') THEN 0 ELSE 1 END,
      CASE WHEN o.state IN ('paid', 'purchasing') THEN o.created_at END ASC, o.updated_at DESC
    LIMIT 50
  `).all();
  return reply({ orders: results.map(row => ({
    ...publicOrder(row, true), email: row.email, assignedToMe: row.handled_by === admin.id,
    supplierOrder: row.supplier_order,
  })) });
}

async function fulfill(request, env, admin, id, action) {
  const row = await env.DB.prepare('SELECT * FROM shop_orders WHERE id = ?').bind(id).first();
  if (!row) throw new ShopError('订单不存在。', 404);
  const mine = row.handled_by === admin.id;
  let update;
  if (action === 'claim') {
    await readInput(request, []);
    if (row.state === 'purchasing' && mine) return reply({ order: publicOrder(row, true) });
    update = await env.DB.prepare("UPDATE shop_orders SET state = 'purchasing', handled_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'paid'")
      .bind(admin.id, id).run();
  } else if (action === 'refund') {
    const input = await readInput(request, ['confirmed']);
    if (input.confirmed !== true) throw new ShopError('请确认退款。', 400);
    if (row.state === 'refunded') return reply({ order: publicOrder(row, true) });
    update = await env.DB.prepare(`UPDATE shop_orders SET state = 'refunded', handled_by = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND (state = 'paid' OR (state = 'purchasing' AND handled_by = ?))`).bind(admin.id, id, admin.id).run();
  } else {
    const input = await readInput(request, ['code', 'supplierOrder']);
    const code = cardCode(input.code);
    const supplierOrder = typeof input.supplierOrder === 'string' ? input.supplierOrder.trim() : '';
    if (!code || !/^[A-Za-z0-9_-]{4,128}$/.test(supplierOrder)) throw new ShopError('请填写卡密和上游订单号。', 400);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.toUpperCase()));
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (row.state === 'delivered' && mine && row.card_fingerprint === fingerprint && row.supplier_order === supplierOrder) {
      return reply({ order: publicOrder(row, true) });
    }
    if (row.state !== 'purchasing' || !mine) throw new ShopError('请先认领待发货订单。', 409);
    const { ciphertext, iv } = await encryptSecret(code, env);
    try {
      update = await env.DB.prepare(`UPDATE shop_orders SET state = 'delivered', supplier_order = ?, card_fingerprint = ?,
        card_ciphertext = ?, card_iv = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND state = 'purchasing' AND handled_by = ?`)
        .bind(supplierOrder, fingerprint, ciphertext, iv, id, admin.id).run();
    } catch (error) {
      if (/\bUNIQUE constraint failed\b/i.test(error.message)) throw new ShopError('该卡密或上游订单号已用于发货。', 409);
      throw error;
    }
  }
  const current = await env.DB.prepare('SELECT * FROM shop_orders WHERE id = ?').bind(id).first();
  if (!update.meta.changes) throw new ShopError('订单状态已变化，请刷新。', 409);
  return reply({ order: publicOrder(current, true) });
}

export async function handleShopRoute(request, env, path, { sessionFor, activeAdminFor }) {
  if (env.BOTGO_SHOP_ENABLED !== '1' || !env.YUNSHU_SHOP_API_KEY?.trim()) return missing();
  const method = request.method;
  if (method === 'POST' && request.headers.get('origin') !== new URL(request.url).origin) {
    return reply({ error: '请求来源不正确。' }, 403);
  }
  try {
    if (method === 'GET' && path === '/shop/config') return reply({ enabled: true });
    if (method === 'GET' && path === '/shop/catalog') {
      const products = new Map();
      for (const { region, ...product } of await gptProducts(env)) {
        const current = products.get(product.name);
        if (!current || (!current.available && product.available)) products.set(product.name, product);
      }
      return reply({ products: [...products.values()] });
    }
    if (path.startsWith('/admin/shop/')) {
      const admin = await activeAdminFor(request, env);
      if (!admin) return reply({ error: '需要管理员权限。' }, 403);
      if (method === 'GET' && path === '/admin/shop/orders') return await adminOrders(env, admin);
      const match = /^\/admin\/shop\/orders\/([^/]+)\/(claim|deliver|refund)$/.exec(path);
      if (method === 'POST' && match && orderId.test(match[1])) return await fulfill(request, env, admin, match[1], match[2]);
      return missing();
    }
    const session = await sessionFor(request, env);
    if (!session) return reply({ error: '请先登录。' }, 401);
    if (path === '/shop/orders') {
      if (method === 'GET') return await ordersFor(request, env, session, activeAdminFor);
      if (method === 'POST') return await checkout(request, env, session.sub);
    }
    const match = /^\/shop\/orders\/([^/]+)\/card$/.exec(path);
    if (method === 'GET' && match && orderId.test(match[1])) return await ownedCard(env, match[1], session.sub);
    if (method === 'POST' && path === '/shop/cards/check') return await verifyCard(request, env, session.sub);
    return missing();
  } catch (error) {
    if (error instanceof ShopError) return reply({ error: error.message }, error.status);
    return reply({ error: '商城操作暂未完成，请重试原操作。' }, 503);
  }
}
