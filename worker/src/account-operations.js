const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store'}});

export async function consumeLoginCode(env,email,tokenHash) {
 const row=await env.DB.prepare('SELECT token_hash,expires_at,attempts,consumed_at FROM email_login_codes WHERE email=? ORDER BY expires_at DESC LIMIT 1').bind(email).first();
 if(!row||row.consumed_at||row.expires_at<=new Date().toISOString()||row.attempts>=5)return null;
 const attempt=await env.DB.prepare('UPDATE email_login_codes SET attempts=attempts+1 WHERE token_hash=? AND consumed_at IS NULL AND attempts<5').bind(row.token_hash).run();
 if(!attempt.meta.changes||row.token_hash!==tokenHash)return null;
 // D1 batch is transactional; only the request that consumes the code creates a user.
 const result=await env.DB.batch([
  env.DB.prepare('UPDATE email_login_codes SET consumed_at=CURRENT_TIMESTAMP WHERE token_hash=? AND consumed_at IS NULL').bind(tokenHash),
  env.DB.prepare("INSERT OR IGNORE INTO accounts(id,email,password_hash,credit_balance,verified_at) SELECT ?,?,'email-code-v1',0,CURRENT_TIMESTAMP WHERE changes()=1").bind(crypto.randomUUID(),email)
 ]);
 if(!result[0].meta.changes)return null;
 return env.DB.prepare('SELECT id,email,credit_balance,status FROM accounts WHERE email=?').bind(email).first();
}

export async function grantBalance(request,env,admin,accountId) {
 const body=await request.json().catch(()=>null);
 if(!body||!/^[a-zA-Z0-9_-]{16,128}$/.test(body.id||'')||!Number.isSafeInteger(body.amountCents)||body.amountCents<1||body.amountCents>100000000||typeof body.reason!=='string'||!body.reason.trim()||body.reason.length>200)return json({error:'请输入有效金额和赠送原因。'},400);
 const account=await env.DB.prepare('SELECT id FROM accounts WHERE id=?').bind(accountId).first();
 if(!account)return json({error:'账户不存在。'},404);
 await env.DB.prepare('INSERT OR IGNORE INTO account_grants(id,account_id,actor_id,amount_cents,reason) VALUES(?,?,?,?,?)').bind(body.id,accountId,admin.id,body.amountCents,body.reason.trim()).run();
 const record=await env.DB.prepare('SELECT * FROM account_grants WHERE id=?').bind(body.id).first();
 if(record.account_id!==accountId||record.actor_id!==admin.id||record.amount_cents!==body.amountCents||record.reason!==body.reason.trim())return json({error:'请求标识已用于另一笔赠送。'},409);
 return json({ok:true,grant:record});
}
