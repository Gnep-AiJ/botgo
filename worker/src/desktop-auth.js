const textEncoder = new TextEncoder();
const CREDIT_SCALE = 100;

function publicBalance(account) {
  const cents = Number(account.credit_balance) || 0;
  return { credits: Math.round(cents) / CREDIT_SCALE, balanceCents: cents };
}

export class DesktopAuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function defaultSha256(value) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(value))));
}

function defaultRequestId() {
  return crypto.randomUUID();
}

function token(prefix) {
  return `${prefix}_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

function validProof(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,256}$/.test(value);
}

function validAuthorizationId(value) {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,128}$/.test(value);
}

function validDeviceLabel(value) {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= 80;
}

function validLogin(body) {
  return body && typeof body.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) && /^\d{6}$/.test(body.code || "");
}

async function activeDesktopDevice(env, rawDeviceToken, sha256) {
  if (typeof rawDeviceToken !== "string" || !rawDeviceToken.startsWith("bgdt_")) throw new DesktopAuthError("设备凭据无效。");
  const tokenHash = await sha256(rawDeviceToken);
  const device = await env.DB.prepare("SELECT token_hash, account_id, label, expires_at, revoked_at FROM device_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?")
    .bind(tokenHash, new Date().toISOString()).first();
  if (!device) throw new DesktopAuthError("设备凭据无效或已过期。");
  return { device, tokenHash };
}

export async function issueDesktopSession(env, body, { sha256 = defaultSha256, requestId = defaultRequestId } = {}) {
  if (!validLogin(body)) throw new DesktopAuthError("验证码格式不正确。", 400);
  const email = body.email.trim().toLowerCase();
  const codeHash = await sha256(`login:${email}:${body.code}`);
  const verification = await env.DB.prepare("SELECT token_hash, email, expires_at, consumed_at FROM email_login_codes WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?")
    .bind(codeHash, new Date().toISOString()).first();
  if (!verification) throw new DesktopAuthError("验证码无效或已过期。");
  const account = await env.DB.prepare("SELECT id, email, credit_balance, status FROM accounts WHERE email = ?")
    .bind(email).first();
  if (!account || account.status !== "active") throw new DesktopAuthError("账户不可用。", 403);

  const deviceToken = token("bgdt");
  const deviceTokenHash = await sha256(deviceToken);
  const label = typeof body.deviceLabel === "string" && body.deviceLabel.trim() ? body.deviceLabel.trim().slice(0, 80) : "BotGo Desktop";
  const consumed = await env.DB.prepare("UPDATE email_login_codes SET consumed_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND consumed_at IS NULL AND expires_at > ?")
    .bind(codeHash, new Date().toISOString()).run();
  if (!consumed.meta?.changes) throw new DesktopAuthError("验证码无效或已过期。", 400);
  await env.DB.prepare("INSERT INTO device_tokens (token_hash, account_id, label, expires_at) VALUES (?, ?, ?, ?)")
    .bind(deviceTokenHash, account.id, label, new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString()).run();
  return { deviceToken, account: { email: account.email, ...publicBalance(account) } };
}

export async function startDesktopWebAuthorization(env, body, { sha256 = defaultSha256, requestId = defaultRequestId } = {}) {
  if (!validDeviceLabel(body?.deviceLabel) || !validProof(body?.verifier)) {
    throw new DesktopAuthError("桌面授权请求无效。", 400);
  }
  const authorizationId = requestId();
  const verifierHash = await sha256(body.verifier);
  const deviceLabel = body.deviceLabel.trim();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 5).toISOString();
  await env.DB.prepare("INSERT INTO desktop_authorizations (id, verifier_hash, device_label, expires_at) VALUES (?, ?, ?, ?)")
    .bind(authorizationId, verifierHash, deviceLabel, expiresAt).run();
  return { authorizationId, expiresAt, deviceLabel };
}

export async function desktopWebAuthorizationFor(env, authorizationId) {
  if (!validAuthorizationId(authorizationId)) throw new DesktopAuthError("桌面授权请求无效。", 400);
  const authorization = await env.DB.prepare("SELECT id, device_label, expires_at, account_id, approved_at, consumed_at, cancelled_at FROM desktop_authorizations WHERE id = ?")
    .bind(authorizationId).first();
  if (!authorization || authorization.cancelled_at || authorization.consumed_at || authorization.expires_at <= new Date().toISOString()) {
    throw new DesktopAuthError("桌面授权已失效。", 404);
  }
  return authorization;
}

export async function approveDesktopWebAuthorization(env, authorizationId, account, { sha256 = defaultSha256, tokenFactory = token } = {}) {
  const authorization = await desktopWebAuthorizationFor(env, authorizationId);
  if (!account?.id || account.status !== "active" || authorization.account_id || authorization.approved_at) {
    throw new DesktopAuthError("桌面授权不可用。", 409);
  }
  const authorizationCode = tokenFactory("bgac");
  const codeHash = await sha256(authorizationCode);
  const result = await env.DB.prepare("UPDATE desktop_authorizations SET account_id = ?, authorization_code_hash = ?, approved_at = CURRENT_TIMESTAMP WHERE id = ? AND account_id IS NULL AND approved_at IS NULL AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at > ?")
    .bind(account.id, codeHash, authorizationId, new Date().toISOString()).run();
  if (!result.meta?.changes) throw new DesktopAuthError("桌面授权不可用。", 409);
  return { authorizationCode, deviceLabel: authorization.device_label, expiresAt: authorization.expires_at };
}

export async function exchangeDesktopWebAuthorization(env, body, { sha256 = defaultSha256, tokenFactory = token } = {}) {
  if (!validAuthorizationId(body?.authorizationId) || !validProof(body?.verifier) || typeof body?.authorizationCode !== "string" || !body.authorizationCode.startsWith("bgac_")) {
    throw new DesktopAuthError("桌面授权凭据无效。", 400);
  }
  const authorization = await env.DB.prepare("SELECT id, verifier_hash, device_label, expires_at, account_id, authorization_code_hash, approved_at, consumed_at, cancelled_at FROM desktop_authorizations WHERE id = ?")
    .bind(body.authorizationId).first();
  if (!authorization || !authorization.account_id || !authorization.approved_at || authorization.consumed_at || authorization.cancelled_at || authorization.expires_at <= new Date().toISOString()) {
    throw new DesktopAuthError("桌面授权无效、已过期或已使用。", 400);
  }
  const [verifierHash, authorizationCodeHash] = await Promise.all([sha256(body.verifier), sha256(body.authorizationCode)]);
  if (verifierHash !== authorization.verifier_hash || authorizationCodeHash !== authorization.authorization_code_hash) {
    throw new DesktopAuthError("桌面授权凭据无效。", 400);
  }
  const account = await env.DB.prepare("SELECT id, email, credit_balance, status FROM accounts WHERE id = ?")
    .bind(authorization.account_id).first();
  if (!account || account.status !== "active") throw new DesktopAuthError("账户不可用。", 403);

  const deviceToken = tokenFactory("bgdt");
  const deviceTokenHash = await sha256(deviceToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90).toISOString();
  const [consumed, inserted] = await env.DB.batch([
    env.DB.prepare("UPDATE desktop_authorizations SET consumed_at = CURRENT_TIMESTAMP, issued_device_token_hash = ? WHERE id = ? AND verifier_hash = ? AND authorization_code_hash = ? AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at > ?")
      .bind(deviceTokenHash, authorization.id, verifierHash, authorizationCodeHash, new Date().toISOString()),
    env.DB.prepare("INSERT INTO device_tokens (token_hash, account_id, label, expires_at) SELECT ?, account_id, device_label, ? FROM desktop_authorizations WHERE id = ? AND issued_device_token_hash = ? AND consumed_at IS NOT NULL")
      .bind(deviceTokenHash, expiresAt, authorization.id, deviceTokenHash)
  ]);
  if (!consumed.meta?.changes || !inserted.meta?.changes) throw new DesktopAuthError("桌面授权无效、已过期或已使用。", 400);
  return { deviceToken, account: { email: account.email, ...publicBalance(account) } };
}

export async function cancelDesktopWebAuthorization(env, body, { sha256 = defaultSha256 } = {}) {
  if (!validAuthorizationId(body?.authorizationId) || !validProof(body?.verifier)) throw new DesktopAuthError("桌面授权请求无效。", 400);
  const verifierHash = await sha256(body.verifier);
  await env.DB.prepare("UPDATE desktop_authorizations SET cancelled_at = CURRENT_TIMESTAMP WHERE id = ? AND verifier_hash = ? AND approved_at IS NULL AND consumed_at IS NULL AND cancelled_at IS NULL")
    .bind(body.authorizationId, verifierHash).run();
  return { ok: true };
}

export async function desktopCredentialFor(env, rawDeviceToken, { sha256 = defaultSha256 } = {}) {
  const { device, tokenHash } = await activeDesktopDevice(env, rawDeviceToken, sha256);
  const account = await env.DB.prepare("SELECT id, email, credit_balance, status FROM accounts WHERE id = ?")
    .bind(device.account_id).first();
  if (!account || account.status !== "active") throw new DesktopAuthError("账户不可用。", 403);
  const subscription = await env.DB.prepare("SELECT plan, status, expires_at FROM subscriptions WHERE account_id = ?")
    .bind(account.id).first();
  if (!subscription || subscription.status !== "active" || (subscription.expires_at && subscription.expires_at <= new Date().toISOString())) {
    throw new DesktopAuthError("当前账户没有有效订阅。", 403);
  }
  return { account, device, subscription, tokenHash };
}

export async function desktopRelayCredentialFor(env, rawKey, { sha256 = defaultSha256 } = {}) {
  if (typeof rawKey !== "string" || !rawKey.startsWith("bgk_")) return null;
  const keyHash = await sha256(rawKey);
  const credential = await env.DB.prepare("SELECT k.id, k.account_id, a.email, a.credit_balance, a.status, s.plan, s.status AS subscription_status, s.expires_at AS subscription_expires_at FROM api_keys k JOIN accounts a ON a.id = k.account_id JOIN device_tokens d ON d.token_hash = k.device_token_hash JOIN subscriptions s ON s.account_id = a.id WHERE k.key_hash = ? AND k.scope = 'desktop' AND k.revoked_at IS NULL AND d.revoked_at IS NULL AND d.expires_at > ?")
    .bind(keyHash, new Date().toISOString()).first();
  if (!credential || credential.status !== "active" || credential.subscription_status !== "active" || (credential.subscription_expires_at && credential.subscription_expires_at <= new Date().toISOString())) return null;
  return {
    id: credential.id,
    account_id: credential.account_id,
    account: { id: credential.account_id, email: credential.email, credit_balance: credential.credit_balance, status: credential.status },
    subscription: { plan: credential.plan, status: credential.subscription_status, expires_at: credential.subscription_expires_at }
  };
}

export async function issueDesktopKey(env, rawDeviceToken, { sha256 = defaultSha256, requestId = defaultRequestId } = {}) {
  const credential = await desktopCredentialFor(env, rawDeviceToken, { sha256 });
  const rawKey = token("bgk");
  const keyHash = await sha256(rawKey);
  const keyId = requestId();
  await env.DB.batch([
    env.DB.prepare("UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE device_token_hash = ? AND scope = 'desktop' AND revoked_at IS NULL").bind(credential.tokenHash),
    env.DB.prepare("INSERT INTO api_keys (id, account_id, key_hash, key_prefix, label, scope, device_token_hash) VALUES (?, ?, ?, ?, ?, 'desktop', ?)")
      .bind(keyId, credential.account.id, keyHash, rawKey.slice(0, 12), credential.device.label, credential.tokenHash)
  ]);
  return { key: rawKey, keyId, prefix: rawKey.slice(0, 12), account: credential.account, subscription: credential.subscription };
}

export async function revokeDesktopDevice(env, rawDeviceToken, { sha256 = defaultSha256 } = {}) {
  const { tokenHash } = await activeDesktopDevice(env, rawDeviceToken, sha256);
  await env.DB.batch([
    env.DB.prepare("UPDATE device_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND revoked_at IS NULL").bind(tokenHash),
    env.DB.prepare("UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE device_token_hash = ? AND scope = 'desktop' AND revoked_at IS NULL").bind(tokenHash)
  ]);
  return { ok: true };
}
