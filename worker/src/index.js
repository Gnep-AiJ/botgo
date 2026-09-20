import { consumeLoginCode } from "./account-operations.js";
import { connect } from "cloudflare:sockets";
import { DesktopAuthError, approveDesktopWebAuthorization, cancelDesktopWebAuthorization, desktopCredentialFor, desktopRelayCredentialFor, desktopWebAuthorizationFor, exchangeDesktopWebAuthorization, executionKey, executionModelFromVerifiedKey, issueDesktopKey, revokeDesktopDevice, startDesktopWebAuthorization, validateExecutionModel } from "./desktop-auth.js";
import { handlePlatformRoute, resolveUpstreamCandidates } from "./platform-admin.js";
import { conversationRoute, startConversationTurn, purgeExpiredConversations } from "./conversations.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const SMTP_MAX_REPLY_BYTES = 16 * 1024;
// Balances are stored as integer fen (cents). One existing quota unit maps to
// one yuan, so the migration keeps the old visible balance and request cost.
const CREDIT_SCALE = 100;

function balanceYuan(value) {
  const cents = Number(value);
  return Number.isFinite(cents) ? Math.round(cents) / CREDIT_SCALE : 0;
}

function publicAccount(account) {
  return {
    email: account.email,
    credits: balanceYuan(account.credit_balance)+(Number(account.credit_remainder_micros)||0)/1e6,
    balanceCents: Number(account.credit_balance) || 0,
    balanceMicros: (Number(account.credit_balance)||0)*10000+(Number(account.credit_remainder_micros)||0),
    reservedMicros: Number(account.billing_reserved_micros)||0
  };
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}

function requestId() {
  return crypto.randomUUID();
}

function base64url(bytes) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function sha256(value) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

function decodeBase64url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

function readCookie(request, name) {
  const value = request.headers.get("cookie") || "";
  return value.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}

async function sessionFor(request, env) {
  const token = readCookie(request, "botgo_session") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature !== await hmac(payload, env.AUTH_SECRET)) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(decodeBase64url(payload)));
    if (data.exp <= Date.now()) return null;
    const account = await env.DB.prepare("SELECT status FROM accounts WHERE id=?").bind(data.sub).first();
    return account?.status === "active" ? data : null;
  } catch {
    return null;
  }
}

async function createSession(account, env) {
  const payload = base64url(encoder.encode(JSON.stringify({ sub: account.id, email: account.email, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 })));
  return `${payload}.${await hmac(payload, env.AUTH_SECRET)}`;
}

function emailIsValid(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

async function bodyOf(request) {
  try { return await request.json(); } catch { return null; }
}

async function audit(env, accountId, event, metadata = {}) {
  await env.DB.prepare("INSERT INTO security_audit (id, account_id, event, metadata) VALUES (?, ?, ?, ?)")
    .bind(requestId(), accountId || null, event, JSON.stringify(metadata)).run();
}

function smtpBase64(value) {
  return btoa(String.fromCharCode(...encoder.encode(value)));
}

function smtpMessage(from, to, code) {
  const subject = `=?UTF-8?B?${smtpBase64("BotGo 验证码")}?=`;
  const text = `你的 BotGo 验证码：${code}\n10 分钟内有效，请勿转发。`;
  const body = smtpBase64(text).match(/.{1,76}/g)?.join("\r\n") || "";
  return [
    `From: =?UTF-8?B?${smtpBase64("BotGo")}?= <${from}>`,
    `To: <${to}>`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body
  ].join("\r\n");
}

function smtpReplyReader(socket) {
  const reader = socket.readable.getReader();
  let buffer = "";

  async function readLine() {
    while (true) {
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd >= 0) {
        const line = buffer.slice(0, lineEnd + 1).replace(/\r?\n$/, "");
        buffer = buffer.slice(lineEnd + 1);
        return line;
      }
      const { value, done } = await reader.read();
      if (done) throw new Error("SMTP connection closed before a reply");
      buffer += decoder.decode(value, { stream: true });
      if (encoder.encode(buffer).byteLength > SMTP_MAX_REPLY_BYTES) throw new Error("SMTP reply exceeded the limit");
    }
  }

  return {
    async readReply() {
      const first = await readLine();
      const match = /^(\d{3})([ -])/.exec(first);
      if (!match) throw new Error("SMTP returned an invalid reply");
      const [, code, separator] = match;
      if (separator === " ") return Number(code);
      while (true) {
        const line = await readLine();
        if (line.startsWith(`${code} `)) return Number(code);
      }
    },
    release() {
      reader.releaseLock();
    }
  };
}

async function smtpWrite(writer, value) {
  if (/\r|\n/.test(value)) throw new Error("SMTP command contained a line break");
  await writer.write(encoder.encode(`${value}\r\n`));
}

async function smtpCommand(reader, writer, command, expectedCodes) {
  await smtpWrite(writer, command);
  const reply = await reader.readReply();
  if (!expectedCodes.includes(reply)) throw new Error("SMTP rejected the request");
}

async function sendVerificationEmail(env, email, code) {
  const from = typeof env.QQ_SMTP_USER === "string" ? env.QQ_SMTP_USER.trim().toLowerCase() : "";
  const authCode = typeof env.QQ_SMTP_AUTH_CODE === "string" ? env.QQ_SMTP_AUTH_CODE.trim() : "";
  if (!emailIsValid(from) || !authCode || !emailIsValid(email) || !/^\d{6}$/.test(code)) {
    throw new Error("Email delivery is not configured");
  }

  const socket = connect({ hostname: "smtp.qq.com", port: 465 }, { secureTransport: "on" });
  const reader = smtpReplyReader(socket);
  const writer = socket.writable.getWriter();
  try {
    if ((await reader.readReply()) !== 220) throw new Error("SMTP greeting was rejected");
    await smtpCommand(reader, writer, "EHLO botgo.invalid", [250]);
    await smtpCommand(reader, writer, "AUTH LOGIN", [334]);
    await smtpCommand(reader, writer, smtpBase64(from), [334]);
    await smtpCommand(reader, writer, smtpBase64(authCode), [235]);
    await smtpCommand(reader, writer, `MAIL FROM:<${from}>`, [250]);
    await smtpCommand(reader, writer, `RCPT TO:<${email}>`, [250, 251]);
    await smtpCommand(reader, writer, "DATA", [354]);
    await writer.write(encoder.encode(`${smtpMessage(from, email, code)}\r\n.\r\n`));
    if ((await reader.readReply()) !== 250) throw new Error("SMTP did not accept the message");
    await smtpWrite(writer, "QUIT");
  } finally {
    try { await writer.close(); } catch {}
    reader.release();
    socket.close();
  }
}

async function verificationRequestGuard(request, env, email, table, auditEvent) {
  const recentlyIssued = await env.DB.prepare(
    `SELECT token_hash FROM ${table} WHERE email = ? AND consumed_at IS NULL AND expires_at > ?`
  ).bind(email, new Date(Date.now() + 9 * 60 * 1000).toISOString()).first();
  if (recentlyIssued) return { response: json({ error: "验证码已发送，请稍后再试。" }, 429) };

  const ipHash = await sha256(request.headers.get("CF-Connecting-IP") || "unavailable");
  const recentRequests = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM security_audit WHERE event = ? AND created_at >= datetime('now', '-1 hour') AND json_extract(metadata, '$.ipHash') = ?"
  ).bind(auditEvent, ipHash).first();
  if (Number(recentRequests?.count || 0) >= 5) {
    return { response: json({ error: "验证码请求过于频繁，请稍后再试。", code: "Too many verification requests" }, 429) };
  }

  return { ipHash };
}

async function redeemInvite(request, env) {
  const diagnostic = { stage: "reading_request" };
  try {
    return await redeemInviteInner(request, env, diagnostic);
  } catch (error) {
    console.error("Registration request failed", { stage: diagnostic.stage, message: error instanceof Error ? error.message : String(error) });
    return json({ error: "注册服务暂不可用，请稍后重试。", code: `registration_${diagnostic.stage}` }, 503);
  }
}

async function redeemInviteInner(request, env, diagnostic) {
  diagnostic.stage = "reading_request";
  const body = await bodyOf(request);
  if (!body) return json({ error: "注册信息无效，请重新填写。" }, 400);
  if (!emailIsValid(body.email)) return json({ error: "请输入有效邮箱地址。" }, 400);
  if (typeof body.inviteCode !== "string" || !body.inviteCode.trim()) return json({ error: "请输入邀请码。" }, 400);
  const email = body.email.trim().toLowerCase();
  diagnostic.stage = "checking_invite";
  const inviteHash = await sha256(body.inviteCode.trim());
  const invite = await env.DB.prepare("SELECT code_hash, expires_at, redeemed_by FROM invite_codes WHERE code_hash = ?").bind(inviteHash).first();
  if (!invite || invite.redeemed_by || (invite.expires_at && invite.expires_at <= new Date().toISOString())) return json({ error: "邀请码无效、已使用或已过期。" }, 400);
  diagnostic.stage = "checking_account";
  if (await env.DB.prepare("SELECT id FROM accounts WHERE email = ?").bind(email).first()) return json({ error: "该邮箱已注册。" }, 409);
  diagnostic.stage = "guarding_verification";
  const guard = await verificationRequestGuard(request, env, email, "email_verifications", "invite_verification_requested");
  if (guard.response) return guard.response;

  diagnostic.stage = "creating_verification";
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const verificationHash = await sha256(`${email}:${code}`);
  diagnostic.stage = "saving_verification";
  await env.DB.prepare("DELETE FROM email_verifications WHERE email = ?").bind(email).run();
  await env.DB.prepare("INSERT INTO email_verifications (token_hash, email, invite_code_hash, password_hash, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(verificationHash, email, inviteHash, "email-code-v1", new Date(Date.now() + 10 * 60 * 1000).toISOString()).run();
  diagnostic.stage = "sending_verification";
  try {
    await sendVerificationEmail(env, email, code);
  } catch (error) {
    await env.DB.prepare("DELETE FROM email_verifications WHERE token_hash = ?").bind(verificationHash).run();
    return json({ error: "邮件服务尚未配置或暂不可用。" }, 503);
  }
  diagnostic.stage = "auditing_registration";
  await audit(env, null, "invite_verification_requested", { emailHash: await sha256(email), ipHash: guard.ipHash });
  return json({ ok: true, message: "验证码已发送。" }, 202);
}

function normalizeVerificationCode(value) {
  return String(value || "").trim().replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xfee0));
}

async function verifyEmail(request, env) {
  const body = await bodyOf(request);
  const code = normalizeVerificationCode(body?.code);
  if (!body || !emailIsValid(body.email) || !/^\d{6}$/.test(code)) return json({ error: "请输入邮件中的 6 位验证码。" }, 400);
  const email = body.email.trim().toLowerCase();
  const tokenHash = await sha256(`${email}:${code}`);
  const verification = await env.DB.prepare("SELECT * FROM email_verifications WHERE token_hash = ? AND consumed_at IS NULL").bind(tokenHash).first();
  if (!verification || verification.expires_at <= new Date().toISOString()) return json({ error: "验证码无效或已过期。" }, 400);
  const invite = await env.DB.prepare("SELECT * FROM invite_codes WHERE code_hash = ? AND redeemed_by IS NULL").bind(verification.invite_code_hash).first();
  if (!invite) return json({ error: "邀请码已被使用。" }, 409);
  const account = { id: requestId(), email };
  const statements = [
    env.DB.prepare("INSERT INTO accounts (id, email, password_hash, credit_balance, verified_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)").bind(account.id, email, verification.password_hash, invite.credits),
    env.DB.prepare("INSERT INTO subscriptions (account_id, plan, status) VALUES (?, 'free', 'active')").bind(account.id),
    env.DB.prepare("UPDATE invite_codes SET redeemed_by = ?, redeemed_at = CURRENT_TIMESTAMP WHERE code_hash = ? AND redeemed_by IS NULL").bind(account.id, verification.invite_code_hash),
    env.DB.prepare("UPDATE email_verifications SET consumed_at = CURRENT_TIMESTAMP WHERE token_hash = ?").bind(tokenHash)
  ];
  await env.DB.batch(statements);
  await audit(env, account.id, "account_created");
  const token = await createSession(account, env);
  return json({ ok: true, account: publicAccount({ email, credit_balance: invite.credits }) }, 201, { "set-cookie": `botgo_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` });
}

async function login(request, env) {
  const body = await bodyOf(request);
  const code = normalizeVerificationCode(body?.code);
  if (!body || !emailIsValid(body.email) || !/^\d{6}$/.test(code)) return json({ error: "请输入邮件中的 6 位验证码。" }, 400);
  const email = body.email.trim().toLowerCase();
  const tokenHash = await sha256(`login:${email}:${code}`);
  const account = await consumeLoginCode(env,email,tokenHash);
  if (!account) return json({ error: "验证码无效、已使用或已过期。" }, 400);
  if (account.status !== "active") return json({ error: "账户不可用。" }, 403);
  const token = await createSession(account, env);
  await audit(env, account.id, "email_code_login");
  return json({ ok: true, account: publicAccount(account) }, 200, { "set-cookie": `botgo_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` });
}

async function requestLoginCode(request, env) {
  const body = await bodyOf(request);
  if (!body || !emailIsValid(body.email)) return json({ error: "请输入有效邮箱地址。" }, 400);
  const email = body.email.trim().toLowerCase();
  const account = await env.DB.prepare("SELECT id, status FROM accounts WHERE email = ?").bind(email).first();
  if (account && account.status !== "active") return json({ error: "账户不可用。" }, 403);
  const guard = await verificationRequestGuard(request, env, email, "email_login_codes", "login_verification_requested");
  if (guard.response) return guard.response;
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  const tokenHash = await sha256(`login:${email}:${code}`);
  await env.DB.prepare("DELETE FROM email_login_codes WHERE email = ?").bind(email).run();
  await env.DB.prepare("INSERT INTO email_login_codes (token_hash, email, expires_at) VALUES (?, ?, ?)")
    .bind(tokenHash, email, new Date(Date.now() + 10 * 60 * 1000).toISOString()).run();
  try {
    await sendVerificationEmail(env, email, code);
  } catch {
    await env.DB.prepare("DELETE FROM email_login_codes WHERE token_hash = ?").bind(tokenHash).run();
    return json({ error: "邮件服务尚未配置或暂不可用。" }, 503);
  }
  await audit(env, account?.id || null, "login_verification_requested", { emailHash: await sha256(email), ipHash: guard.ipHash });
  return json({ ok: true, message: "验证码已发送。" }, 202);
}

async function accountInfo(request, env) {
  const session = await sessionFor(request, env);
  if (!session) return json({ error: "请先登录。" }, 401);
  const account = await env.DB.prepare("SELECT email, credit_balance, credit_remainder_micros, billing_reserved_micros, status FROM accounts WHERE id = ?").bind(session.sub).first();
  if (!account || account.status !== "active") return json({ error: "账户不可用。" }, 403);
  const subscription = {plan:"metered",status:"active",expires_at:null};
  return json({ account: { ...publicAccount(account), plan: subscription?.plan || "free", subscriptionStatus: subscription?.status || "inactive", subscriptionExpiresAt: subscription?.expires_at || null } });
}

async function activeAdminFor(request, env) {
  const session = await sessionFor(request, env);
  if (!session) return null;
  const account = await env.DB.prepare("SELECT id, email, role, status FROM accounts WHERE id = ?").bind(session.sub).first();
  if (!account || account.status !== "active") return null;
  const configuredAdmin = typeof env.ADMIN_EMAIL === "string" && account.email === env.ADMIN_EMAIL.trim().toLowerCase();
  return account.role === "admin" || configuredAdmin ? account : null;
}

async function devTestLogin(request, env) {
  if (env.DEV_TEST_MODE !== "1" || !emailIsValid(env.DEV_TEST_EMAIL)) return json({ error: "接口不存在。" }, 404);
  const email = env.DEV_TEST_EMAIL.trim().toLowerCase();
  let account = await env.DB.prepare("SELECT id, email, credit_balance, status FROM accounts WHERE email = ?").bind(email).first();
  if (!account) {
    account = { id: requestId(), email, credit_balance: 100 * CREDIT_SCALE, status: "active" };
    await env.DB.batch([
      env.DB.prepare("INSERT INTO accounts (id, email, password_hash, credit_balance, verified_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)").bind(account.id, email, "email-code-v1", account.credit_balance),
      env.DB.prepare("INSERT INTO subscriptions (account_id, plan, status) VALUES (?, 'free', 'active')").bind(account.id),
    ]);
    await audit(env, account.id, "dev_test_account_created");
  }
  if (account.status !== "active") return json({ error: "测试账户不可用。" }, 403);
  const token = await createSession(account, env);
  await audit(env, account.id, "dev_test_login");
  return json({ ok: true, account: publicAccount(account) }, 200, { "set-cookie": `botgo_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800` });
}

async function adminOverview(request, env) {
  const admin = await activeAdminFor(request, env);
  if (!admin) return json({ error: "需要管理员权限。" }, 403);
  const [accounts, active, verifications, recent] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS count FROM accounts").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM accounts WHERE status = 'active'").first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM email_verifications WHERE consumed_at IS NULL AND expires_at > CURRENT_TIMESTAMP").first(),
    env.DB.prepare("SELECT id, email, role, status, credit_balance, created_at FROM accounts ORDER BY created_at DESC LIMIT 50").all(),
  ]);
  return json({
    overview: { accounts: Number(accounts?.count || 0), active: Number(active?.count || 0), pendingVerifications: Number(verifications?.count || 0) },
    accounts: (recent.results || []).map((row) => ({ ...row, credit_balance: balanceYuan(row.credit_balance), credit_balance_cents: Number(row.credit_balance) || 0 })),
    admin: { email: admin.email }
  });
}

function inviteHashIsValid(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function inviteCode() {
  return `BGO-${base64url(crypto.getRandomValues(new Uint8Array(9))).toUpperCase()}`;
}

async function adminInvites(request, env) {
  const admin = await activeAdminFor(request, env);
  if (!admin) return json({ error: "需要管理员权限。" }, 403);
  if (request.method === "GET") {
    const rows = await env.DB.prepare("SELECT code_hash, label, credits, expires_at, redeemed_at FROM invite_codes ORDER BY redeemed_at IS NULL DESC, expires_at DESC LIMIT 100").all();
    return json({ invites: (rows.results || []).map((row) => ({ ...row, credits: balanceYuan(row.credits), creditsCents: Number(row.credits) || 0 })) });
  }
  const body = await bodyOf(request);
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 48) : "";
  const credits = Number(body?.credits);
  if (!label || !Number.isInteger(credits) || credits < 0 || credits > 1000000) return json({ error: "请填写邀请码名称和有效额度。" }, 400);
  const code = inviteCode();
  const codeHash = await sha256(code);
  await env.DB.prepare("INSERT INTO invite_codes (code_hash, label, credits) VALUES (?, ?, ?)").bind(codeHash, label, credits * CREDIT_SCALE).run();
  await audit(env, admin.id, "invite_created", { label, credits });
  return json({ invite: { code, label, credits } }, 201);
}

async function revokeInvite(request, env, codeHash) {
  const admin = await activeAdminFor(request, env);
  if (!admin) return json({ error: "需要管理员权限。" }, 403);
  if (!inviteHashIsValid(codeHash)) return json({ error: "邀请码标识不正确。" }, 400);
  const result = await env.DB.prepare("UPDATE invite_codes SET expires_at = CURRENT_TIMESTAMP WHERE code_hash = ? AND redeemed_by IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)").bind(codeHash).run();
  if (!result.meta?.changes) return json({ error: "邀请码不可撤销。" }, 409);
  await audit(env, admin.id, "invite_revoked", { codeHash });
  return json({ ok: true });
}

async function updateAccountStatus(request, env, accountId) {
  const admin = await activeAdminFor(request, env);
  if (!admin) return json({ error: "需要管理员权限。" }, 403);
  const body = await bodyOf(request);
  if (!accountId || !["active", "suspended"].includes(body?.status)) return json({ error: "账户状态不正确。" }, 400);
  if (accountId === admin.id) return json({ error: "不能修改当前管理员账户状态。" }, 409);
  const result = await env.DB.prepare("UPDATE accounts SET status = ? WHERE id = ? AND role != 'admin'").bind(body.status, accountId).run();
  if (!result.meta?.changes) return json({ error: "账户不存在或不可修改。" }, 404);
  await audit(env, admin.id, "account_status_changed", { accountId, status: body.status });
  return json({ ok: true });
}

function bearerToken(request) {
  const value = request.headers.get("authorization") || "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function desktopFailure(error) {
  if (error instanceof DesktopAuthError) return json({ error: error.message }, error.status);
  return json({ error: "桌面服务暂不可用，请稍后重试。" }, 503);
}

async function activeSessionAccount(request, env) {
  const session = await sessionFor(request, env);
  if (!session) throw new DesktopAuthError("请先登录 BotGo 网页账户。", 401);
  const account = await env.DB.prepare("SELECT id, email, credit_balance, status FROM accounts WHERE id = ?").bind(session.sub).first();
  if (!account || account.status !== "active") throw new DesktopAuthError("账户不可用。", 403);
  return account;
}

async function desktopAuthorizationStart(request, env) {
  try {
    const ipHash = await sha256(request.headers.get("CF-Connecting-IP") || "unavailable");
    const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM security_audit WHERE event = ? AND created_at >= datetime('now', '-10 minutes') AND json_extract(metadata, '$.ipHash') = ?")
      .bind("desktop_web_authorization_started", ipHash).first();
    if (Number(recent?.count || 0) >= 10) return json({ error: "桌面授权请求过于频繁，请稍后再试。" }, 429);
    await env.DB.prepare("DELETE FROM desktop_authorizations WHERE expires_at <= ?").bind(new Date().toISOString()).run();
    const result = await startDesktopWebAuthorization(env, await bodyOf(request));
    await audit(env, null, "desktop_web_authorization_started", { ipHash });
    return json({ authorizationId: result.authorizationId, expiresAt: result.expiresAt });
  } catch (error) {
    return desktopFailure(error);
  }
}

async function desktopAuthorizationRequest(request, env, authorizationId) {
  try {
    const [account, authorization] = await Promise.all([
      activeSessionAccount(request, env),
      desktopWebAuthorizationFor(env, authorizationId)
    ]);
    return json({ account: publicAccount(account), authorization: { id: authorization.id, deviceLabel: authorization.device_label, expiresAt: authorization.expires_at, approved: Boolean(authorization.approved_at) } });
  } catch (error) {
    return desktopFailure(error);
  }
}

async function desktopAuthorizationApprove(request, env) {
  try {
    const body = await bodyOf(request);
    const account = await activeSessionAccount(request, env);
    const result = await approveDesktopWebAuthorization(env, body?.authorizationId, account);
    await audit(env, account.id, "desktop_web_authorization_approved", { authorizationId: body?.authorizationId, deviceLabel: result.deviceLabel });
    return json({ authorizationCode: result.authorizationCode });
  } catch (error) {
    return desktopFailure(error);
  }
}

async function desktopAuthorizationExchange(request, env) {
  try {
    const result = await exchangeDesktopWebAuthorization(env, await bodyOf(request));
    await audit(env, null, "desktop_web_authorization_exchanged", { email: result.account.email });
    return json({ ok: true, deviceToken: result.deviceToken, account: result.account }, 201);
  } catch (error) {
    return desktopFailure(error);
  }
}

async function desktopAuthorizationCancel(request, env) {
  try {
    await cancelDesktopWebAuthorization(env, await bodyOf(request));
    return json({ ok: true });
  } catch (error) {
    return desktopFailure(error);
  }
}

async function desktopAccount(request, env) {
  try {
    const credential = await desktopCredentialFor(env, bearerToken(request));
    await env.DB.prepare("UPDATE device_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE token_hash = ?").bind(credential.tokenHash).run();
    return json({ account: { ...publicAccount(credential.account), plan: credential.subscription.plan } });
  } catch (error) {
    return desktopFailure(error);
  }
}

async function desktopIssueKey(request, env) {
  try {
    const body = await bodyOf(request) || {};
    const result = await issueDesktopKey(env, bearerToken(request), { model: body.model });
    await audit(env, result.account.id, "desktop_key_issued", { keyId: result.keyId, plan: result.subscription.plan, model: result.model });
    return json({ key: result.key, prefix: result.prefix }, 201);
  } catch (error) {
    return desktopFailure(error);
  }
}

async function desktopRevoke(request, env) {
  try {
    await revokeDesktopDevice(env, bearerToken(request));
    return json({ ok: true });
  } catch (error) {
    return desktopFailure(error);
  }
}

async function activeSubscription(env, accountId) {
  const subscription = await env.DB.prepare("SELECT plan, status, expires_at FROM subscriptions WHERE account_id = ?").bind(accountId).first();
  if (!subscription || subscription.status !== "active") return null;
  if (subscription.expires_at && subscription.expires_at <= new Date().toISOString()) return null;
  return subscription;
}

async function issueCodexKey(request, env) {
  const session = await sessionFor(request, env);
  if (!session) return json({ error: "请先登录。" }, 401);
  const subscription = await activeSubscription(env, session.sub);
  const body = await bodyOf(request) || {};
  if (body.model !== undefined) {
    try { await validateExecutionModel(env, body.model); }
    catch (error) { return desktopFailure(error); }
  }
  const rawKey = executionKey(body.model);
  const keyHash = await sha256(rawKey);
  const keyId = requestId();
  await env.DB.batch([
    env.DB.prepare("UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE account_id = ? AND scope IN ('codex', 'agent') AND revoked_at IS NULL").bind(session.sub),
    env.DB.prepare("INSERT INTO api_keys (id, account_id, key_hash, key_prefix, label, scope) VALUES (?, ?, ?, ?, ?, 'agent')").bind(keyId, session.sub, keyHash, rawKey.slice(0, 12), "BotGo Agent API")
  ]);
  await audit(env, session.sub, "agent_key_issued", { keyId, plan: subscription?.plan || "metered", model: body.model ?? null });
  return json({ key: rawKey, prefix: rawKey.slice(0, 12), instruction: "Use this BotGo API Key for BotGo Desktop." }, 201);
}

async function credentialFor(request, env, includeDesktop = false) {
  const rawKey = bearerToken(request);
  if (!rawKey || !rawKey.startsWith("bgk_")) return null;
  if (includeDesktop) {
    const desktopCredential = await desktopRelayCredentialFor(env, rawKey);
    if (desktopCredential) return desktopCredential;
  }
  const keyHash = await sha256(rawKey);
  const credential = await env.DB.prepare("SELECT k.id, k.account_id, a.credit_balance, a.status FROM api_keys k JOIN accounts a ON a.id = k.account_id WHERE k.key_hash = ? AND k.scope IN ('codex', 'agent') AND k.revoked_at IS NULL AND (k.expires_at IS NULL OR k.expires_at > CURRENT_TIMESTAMP)").bind(keyHash).first();
  if (!credential || credential.status !== "active") return null;
  const model = executionModelFromVerifiedKey(rawKey);
  return model === undefined ? null : { ...credential, model };
}


async function proxyCodexModels(request, env) {
  const credential = await credentialFor(request, env, true);
  if (!credential) return json({ error: "BotGo Key 无效或已撤销。" }, 401);
  await env.DB.prepare("UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?").bind(credential.id).run();
  const available = await catalog(env);
  return json({ object: "list", data: available.models.filter(m=>m.enabled&&m.agent_enabled).map(m=>({id:m.id,object:'model',created:0,owned_by:'botgo'})) });
}


import { handleAgentRelease } from "./agent-releases.js";
import { autoReviewCapability, catalog, publicCatalog, meteredProxy } from "./metering.js";
import { handleOpenCode } from './opencode-gateway.js';

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(purgeExpiredConversations(env)); },
  async fetch(request, env, ctx) {
    if (env.BOTGO_MAINTENANCE === "1") return json({ error: "服务更新中，请稍后重试。" }, 503, { "retry-after": "60" });
    if (!env.DB || !env.AUTH_SECRET) return json({ error: "后端绑定尚未配置。" }, 503);
    const path = new URL(request.url).pathname;
    const openCodeResponse=await handleOpenCode(request,env,ctx,path);
    if(openCodeResponse)return openCodeResponse;
    if (request.method === 'GET' && path === '/models') {
      const data=await catalog(env),token=bearerToken(request);
      const desktop=token?.startsWith('bgdt_')?await desktopCredentialFor(env,token):null;
      return json(publicCatalog(data,{autoReview:desktop?await autoReviewCapability(env,data):false}));
    }
    if (path === '/chat/stream' || path === '/conversations' || path.startsWith('/conversations/')) {
      return json({error:'网页对话已停用，请下载 BotGo 桌面客户端。'},410);
    }
    if (path === '/conversations' || path.startsWith('/conversations/')) {
      const identity = await sessionFor(request, env);
      return await conversationRoute(request, env, identity?.sub, path) || json({error:'对话不存在。'},404);
    }
    if (request.method === 'POST' && path === '/v1/responses') {
      const channel = 'desktop_codex';
      const identity = await credentialFor(request, env, true);
      if (!identity) return json({error:'请先登录 BotGo。'},401);
      const body = await bodyOf(request);
      if (!body || typeof body.model !== 'string') return json({error:'请求不完整。'},400);
      const candidates = await resolveUpstreamCandidates(env, channel);
      if (!candidates.length) return json({error:'上游服务尚未配置。'},503);
      const accountId=identity.sub || identity.account_id;
      if(channel==='web_chat' && body.conversationId) {
        const turn=await startConversationTurn(env,accountId,body);
        if(turn.response)return turn.response;
        try {
          const headers=new Headers(request.headers);headers.set('idempotency-key',body.requestId);
          const response=await meteredProxy(new Request(request.url,{method:request.method,headers,signal:request.signal}),env,ctx,{accountId,channel,body:turn.body,candidates,history:turn.history});
          if(!response.ok)await turn.history.finish('failed');
          return response;
        } catch(error) {await turn.history.finish('failed');throw error;}
      }
      return meteredProxy(request, env, ctx, {accountId, channel, body, candidates, billingModel: channel==='desktop_codex'?identity.model:null});
    }
    if (path.startsWith('/agent/releases/')) return json({error:'BotGo CLI 已停止发布，请使用桌面客户端。'},410);
    const platformResponse = await handlePlatformRoute(request, env, path, { activeAdminFor, audit, sessionFor });
    if (platformResponse) return platformResponse;
    if (request.method === "GET" && path === "/health") return json({ ok: true, service: "botgo-api" });
    if (request.method === "POST" && path === "/auth/redeem-invite") return json({error:"请使用邮箱验证码登录或注册。"},410);
    if (request.method === "POST" && path === "/auth/verify-email") return json({error:"请重新获取邮箱验证码。"},410);
    if (request.method === "POST" && path === "/auth/request-login-code") return requestLoginCode(request, env);
    if (request.method === "POST" && path === "/auth/login") return login(request, env);
    if (request.method === "POST" && path === "/desktop/authorize/start") return desktopAuthorizationStart(request, env);
    if (request.method === "POST" && path === "/desktop/authorize/approve") return desktopAuthorizationApprove(request, env);
    if (request.method === "POST" && path === "/desktop/authorize/exchange") return desktopAuthorizationExchange(request, env);
    if (request.method === "POST" && path === "/desktop/authorize/cancel") return desktopAuthorizationCancel(request, env);
    const desktopAuthorizationRequestMatch = path.match(/^\/desktop\/authorize\/request\/([A-Za-z0-9-]{1,128})$/);
    if (request.method === "GET" && desktopAuthorizationRequestMatch) return desktopAuthorizationRequest(request, env, desktopAuthorizationRequestMatch[1]);
    if (request.method === "POST" && path === "/auth/dev-test-login") return devTestLogin(request, env);
    if (request.method === "POST" && path === "/auth/logout") return json({ ok: true }, 200, { "set-cookie": "botgo_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
    if (request.method === "GET" && path === "/account") return accountInfo(request, env);
    if (request.method === "POST" && path === "/account/codex-key") return issueCodexKey(request, env);
    if (request.method === "GET" && path === "/desktop/account") return desktopAccount(request, env);
    if (request.method === "POST" && path === "/desktop/key") return desktopIssueKey(request, env);
    if (request.method === "POST" && path === "/desktop/revoke") return desktopRevoke(request, env);
    if (request.method === "GET" && path === "/admin/overview") return adminOverview(request, env);
    if ((request.method === "GET" || request.method === "POST") && path === "/admin/invites") return json({error:"邀请码已停用。"},410);
    const inviteRevokeMatch = path.match(/^\/admin\/invites\/([A-Za-z0-9_-]{43})\/revoke$/);
    if (request.method === "POST" && inviteRevokeMatch) return revokeInvite(request, env, inviteRevokeMatch[1]);
    const accountStatusMatch = path.match(/^\/admin\/accounts\/([^/]+)\/status$/);
    if (request.method === "POST" && accountStatusMatch) return updateAccountStatus(request, env, decodeURIComponent(accountStatusMatch[1]));
    if (request.method === "GET" && path === "/v1/models") return proxyCodexModels(request, env);
    return json({ error: "接口不存在。" }, 404);
  }
};
