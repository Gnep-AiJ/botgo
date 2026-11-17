// Deployment-time overrides.
//
// The public repository stores placeholders for merchant and personal values
// (D1 id, Alipay App ID, callback origin, support email, WeChat id, contact QR).
// Cloudflare builds inject the real values through environment variables, so the
// committed tree never contains them. These helpers are shared by the site build
// and the Worker deploy script and are unit-tested in tests/deploy-config.test.mjs.

export const PLACEHOLDER_SUPPORT_EMAIL = 'support@example.com';
export const PLACEHOLDER_WECHAT_ID = 'YOUR_WECHAT_ID';
export const PLACEHOLDER_PUBLIC_ORIGIN = 'https://your-domain.example';
export const PLACEHOLDER_D1_ID = '00000000-0000-0000-0000-000000000000';
export const PLACEHOLDER_ALIPAY_APP_ID = 'YOUR_ALIPAY_APP_ID';
export const CONTACT_QR_ASSET = 'assets/botgo-contact-wechat.png';

const EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const WECHAT_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{5,19}$/;
const D1_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALIPAY_APP_ID_PATTERN = /^\d{16}$/;
const ORIGIN_PATTERN = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i;

function readEnv(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

/** Replace the committed contact placeholders with deployment values when supplied. */
export function applyContactOverrides(html, env = process.env) {
  let output = html;
  const email = readEnv(env, 'BOTGO_SUPPORT_EMAIL');
  const wechat = readEnv(env, 'BOTGO_WECHAT_ID');
  if (email) {
    if (!EMAIL_PATTERN.test(email)) throw new Error('BOTGO_SUPPORT_EMAIL must be a plain email address');
    output = output.split(PLACEHOLDER_SUPPORT_EMAIL).join(email);
  }
  if (wechat) {
    if (!WECHAT_PATTERN.test(wechat)) throw new Error('BOTGO_WECHAT_ID must be 6-20 letters, digits, "-" or "_"');
    output = output.split(PLACEHOLDER_WECHAT_ID).join(wechat);
  }
  return output;
}

/** Without a contact QR asset the figure must stay hidden instead of loading a 404. */
export function hideContactQr(html) {
  return html.replace('<figure class="contact-qr">', '<figure class="contact-qr" hidden>');
}

/** Fill the Worker template. Fails closed when a required value is missing or malformed. */
export function renderWorkerConfig(source, env = process.env) {
  const d1 = readEnv(env, 'BOTGO_D1_DATABASE_ID');
  const appId = readEnv(env, 'BOTGO_ALIPAY_APP_ID');
  const origin = readEnv(env, 'BOTGO_PUBLIC_ORIGIN').replace(/\/+$/, '');
  const missing = [];
  if (!d1) missing.push('BOTGO_D1_DATABASE_ID');
  if (!appId) missing.push('BOTGO_ALIPAY_APP_ID');
  if (!origin) missing.push('BOTGO_PUBLIC_ORIGIN');
  if (missing.length) throw new Error(`Missing Worker deploy environment: ${missing.join(', ')}`);
  if (!D1_PATTERN.test(d1)) throw new Error('BOTGO_D1_DATABASE_ID must be a D1 database UUID');
  if (!ALIPAY_APP_ID_PATTERN.test(appId)) throw new Error('BOTGO_ALIPAY_APP_ID must be 16 digits');
  if (!ORIGIN_PATTERN.test(origin)) throw new Error('BOTGO_PUBLIC_ORIGIN must be an https origin without a path');

  const rendered = source
    .split(PLACEHOLDER_D1_ID).join(d1)
    .split(PLACEHOLDER_ALIPAY_APP_ID).join(appId)
    .split(PLACEHOLDER_PUBLIC_ORIGIN).join(origin);
  assertNoPlaceholders(rendered);
  return rendered;
}

/** Guard against deploying the public template by accident. */
export function assertNoPlaceholders(text) {
  const found = [
    PLACEHOLDER_D1_ID,
    PLACEHOLDER_ALIPAY_APP_ID,
    PLACEHOLDER_PUBLIC_ORIGIN,
    PLACEHOLDER_SUPPORT_EMAIL,
    PLACEHOLDER_WECHAT_ID
  ].filter((placeholder) => text.includes(placeholder));
  if (found.length) throw new Error(`Deployment placeholders are still present: ${found.join(', ')}`);
}
