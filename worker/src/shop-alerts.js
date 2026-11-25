import { shopAlertMessage } from './mail-templates.js';

const headlines = new Map([
  ['catalog', '商品目录读取异常'],
  ['checkout', '商城结账失败'],
  ['stock', '结账时上游缺货'],
  ['quote', '上游报价超过商城售价'],
  ['cards', '卡密核验服务异常'],
  ['orders', '订单服务异常'],
  ['fulfillment', '发货管理服务异常'],
]);

export async function notifyShopFailure(env, sendEmail, kind, status) {
  const recipient = env.SHOP_ALERT_EMAIL?.trim() || env.ADMIN_EMAIL?.trim();
  if (!recipient || !headlines.has(kind)) return;
  const now = Date.now();
  const retryAfter = now + 30 * 60_000;
  try {
    const inserted = await env.DB.prepare(`
      INSERT INTO shop_alert_throttle (kind, retry_after_ms) VALUES (?, ?)
      ON CONFLICT(kind) DO UPDATE SET retry_after_ms = excluded.retry_after_ms
      WHERE retry_after_ms <= ?
    `).bind(kind, retryAfter, now).run();
    if (!inserted.meta.changes) return;
    const time = new Date(now + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') + ' UTC+8';
    try {
      await sendEmail(env, recipient, shopAlertMessage(headlines.get(kind), status, time));
    } catch (error) {
      await env.DB.prepare('UPDATE shop_alert_throttle SET retry_after_ms = ? WHERE kind = ? AND retry_after_ms = ?')
        .bind(Date.now() + 5 * 60_000, kind, retryAfter).run();
      throw error;
    }
  } catch {
    console.warn(JSON.stringify({ event: 'shop_alert_delivery_failed', kind, status }));
  }
}
