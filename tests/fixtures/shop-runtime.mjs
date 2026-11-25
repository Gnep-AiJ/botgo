import assert from 'node:assert/strict';
import { createWebChatRuntime } from './web-chat-runtime.mjs';

export async function createShopRuntime() {
  const runtime = await createWebChatRuntime();
  const products = [
    { code: 'FIXTURE-PLUS', name: '【直充】GPT Plus 菲区充值', stock: 20, redemption_host: 'redeem.yunpaycard.com' },
    { code: 'FIXTURE-PRO', name: '【直充】G pro 10x 智利区充值', stock: 0, redemption_host: 'redeem.yunpaycard.com' },
    { code: 'FIXTURE-PRO-ALT', name: '【直充】GPT Pro 10X 菲区充值', stock: 3, redemption_host: 'redeem.yunpaycard.com' },
    { code: 'FIXTURE-PRO-20', name: '【直充】GPT Pro 20X 菲区充值', stock: 0, redemption_host: 'redeem.yunpaycard.com' },
    { code: 'FIXTURE-PRO-50', name: '【直充】GPT Pro 50X 智利区充值', stock: 3, redemption_host: 'redeem.yunpaycard.com' },
    { code: 'FIXTURE-PRO-OTHER', name: '【直充】GPT Pro 99X 智利区充值', stock: 3, redemption_host: 'redeem.yunpaycard.com' },
    { code: 'FIXTURE-GO', name: '【直充】GPT GO 埃及区一个月', stock: 10, redemption_host: 'redeem.yunpaycard.com' },
    { code: 'FIXTURE-ACCOUNT', name: '【成品号】GPT Plus 日区', stock: 10, redemption_host: null },
  ];
  const upstream = {
    calls: [], stock: { 'FIXTURE-PLUS': '20', 'FIXTURE-PRO': '0', 'FIXTURE-GO': '10' },
    prices: { 'FIXTURE-PLUS': '107.90', 'FIXTURE-PRO': '609', 'FIXTURE-GO': '33.90' },
    cardStatus: 'valid',
  };
  Object.assign(runtime.env, {
    BOTGO_SHOP_ENABLED: '1',
    YUNSHU_SHOP_API_KEY: 'fixture-yunshu-key',
  });
  runtime.db.exec("UPDATE accounts SET role = 'admin' WHERE id = 'fixture-b'");
  globalThis.fetch = async (url, options) => {
    const parsed = new URL(url);
    const path = parsed.pathname.split('/').at(-1);
    const headers = new Headers(options.headers);
    assert.equal(options.redirect, 'manual');
    assert.equal(headers.has('origin'), false);
    upstream.calls.push(parsed.host + ':' + path);
    if (parsed.host === 'redeem.yunpaycard.com') {
      assert.equal(path, 'check');
      assert.equal(headers.get('x-agent-key'), 'fixture-agent-key');
      assert.equal(headers.has('authorization'), false);
      assert.match(parsed.searchParams.get('code'), /^NCGPT-/);
      return Response.json({ ok: true, status: upstream.cardStatus });
    }
    assert.equal(parsed.host, 'yunshutoken.com');
    assert.equal(headers.get('authorization'), 'Bearer fixture-yunshu-key');
    assert.equal(options.method, 'POST');
    const form = new URLSearchParams(options.body);
    if (path === 'check') {
      assert.deepEqual([...form.keys()], ['code']);
      return Response.json({ code: 200, data: { status: upstream.cardStatus } });
    }
    if (path === 'items') return Response.json({ code: 200, data: [
      { name: 'GPT', children: products },
      { name: 'Grok', children: [{ ...products[0], code: 'FIXTURE-OTHER' }] },
    ] });
    const code = form.get('code');
    assert.ok(Object.hasOwn(upstream.stock, code));
    if (path === 'stock') return Response.json({ code: 200, data: { stock: upstream.stock[code] } });
    if (path === 'quote') {
      assert.equal(form.get('num'), '1');
      return Response.json({ code: 200, data: { currency_code: 'CNY', price: upstream.prices[code] } });
    }
    assert.fail('Unexpected upstream operation: ' + path);
  };
  return { ...runtime, upstream };
}
