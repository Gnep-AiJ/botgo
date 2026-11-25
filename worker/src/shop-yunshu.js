const partnerBase = 'https://yunshutoken.com/partner/v1/';
const agentBase = 'https://redeem.yunpaycard.com/api/v1/agent/';
const regionNames = new Map([
  ['菲区', '菲律宾区'],
  ['菲律宾区', '菲律宾区'],
  ['智利区', '智利区'],
  ['埃及区', '埃及区'],
]);
const productCode = /^[A-Z0-9-]{1,64}$/;
const cardStates = new Set(['valid', 'used', 'processing', 'disabled', 'expired', 'invalid']);
const yuanPerUsd = 7;
const monthlyUsd = new Map([
  ['Go', 8],
  ['Plus', 20],
  ['Pro 5', 100],
  ['Pro 10', 100],
  ['Pro 20', 200],
  ['Pro 50', 500],
]);

export class ShopError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.status = status;
  }
}

async function upstream(url, options) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(6_000), redirect: 'manual' });
  } catch {
    throw new ShopError('上游连接超时或不可用，请稍后重试。');
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new ShopError('上游响应异常，请稍后重试。');
  }
  if (response.status === 429) {
    await response.body?.cancel();
    throw new ShopError('上游正在限流，请稍后再试。', 429);
  }
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function partner(env, endpoint, values = {}) {
  const key = env.YUNSHU_SHOP_API_KEY?.trim();
  if (!key) throw new ShopError('商品服务尚未配置。');
  const { status, data } = await upstream(partnerBase + endpoint, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(values),
  });
  if (status === 404 && endpoint !== 'items' && endpoint !== 'check') {
    throw new ShopError('商品当前不可用，请刷新后重试。', 409);
  }
  if (status === 403 && endpoint === 'check') throw new ShopError('卡密核验权限尚未开通。');
  if (status !== 200 || data?.code !== 200) throw new ShopError('上游暂未返回可用结果，请稍后重试。');
  return data.data;
}

function safeStock(value) {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null;
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

export async function gptProducts(env) {
  const categories = await partner(env, 'items');
  if (!Array.isArray(categories)) throw new ShopError('上游商品目录格式异常。');
  const products = new Map();
  for (const category of categories) {
    if (category?.name !== 'GPT' || !Array.isArray(category.children)) continue;
    for (const item of category.children) {
      if (item?.redemption_host !== 'redeem.yunpaycard.com' || typeof item.code !== 'string' ||
          !productCode.test(item.code) || typeof item.name !== 'string') continue;
      const plan = /^【直充】\s*(?:ChatGPT|GPT|G)\s*(Plus|Go|Pro)(?:\s+(\d{1,2})\s*x\b)?\s*(菲律宾区|菲区|智利区|埃及区)/i.exec(item.name);
      if (!plan) continue;
      const tier = plan[1][0].toUpperCase() + plan[1].slice(1).toLowerCase();
      const usd = monthlyUsd.get(plan[2] ? tier + ' ' + plan[2] : tier);
      const priceCents = usd === undefined ? null : usd * yuanPerUsd * 100;
      const stock = safeStock(item.stock);
      products.set(item.code, {
        id: item.code,
        tier, region: regionNames.get(plan[3]),
        name: 'ChatGPT ' + tier + (plan[2] ? ' ' + plan[2] + '×' : ''),
        stock, priceCents, available: stock !== null && stock > 0 && priceCents !== null,
      });
    }
  }
  const order = ['Plus', 'Pro', 'Go'];
  return [...products.values()].sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier));
}

export async function ensureAvailable(env, product) {
  const [inventory, quote] = await Promise.all([
    partner(env, 'stock', { code: product.id }),
    partner(env, 'quote', { code: product.id, num: '1' }),
  ]);
  const stock = safeStock(inventory?.stock);
  if (stock === 0) throw new ShopError('商品已缺货，请刷新商品列表。', 409);
  const price = String(quote?.price ?? '');
  if (stock === null || quote?.currency_code !== 'CNY' || !/^\d+(?:\.\d{1,2})?$/.test(price)) {
    throw new ShopError('暂时无法确认上游库存或报价。');
  }
  const cents = Math.round(Number(price) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new ShopError('暂时无法确认上游报价。');
  if (cents > product.priceCents) throw new ShopError('商品价格正在更新，请稍后再试。', 409);
}

export function cardCode(value) {
  const code = typeof value === 'string' ? value.trim() : '';
  return /^(?:NCGPT|ZC)-[A-Z0-9-]{4,120}$/i.test(code) ? code : null;
}

export async function checkCard(env, code) {
  const agentKey = env.YUNSHU_REDEEM_API_KEY?.trim();
  let result;
  if (agentKey && /^NCGPT-/i.test(code)) {
    const url = new URL('cdk/check', agentBase);
    url.searchParams.set('code', code);
    const { status, data } = await upstream(url, { headers: { 'x-agent-key': agentKey } });
    if (status === 401 || status === 403) throw new ShopError('卡密核验权限尚未开通。');
    if (status !== 200 && status !== 400 && status !== 404) throw new ShopError('卡密状态暂时不可用。');
    result = data;
  } else {
    result = await partner(env, 'check', { code });
  }
  if (!cardStates.has(result?.status)) throw new ShopError('暂时无法确认卡密状态，请到兑换页核对。');
  return { status: result.status };
}
