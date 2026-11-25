function emailFrame(title, content) {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;background:#edf5fc;color:#112f47;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#edf5fc"><tr><td align="center" style="padding:30px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#fff;border:1px solid #c4deef;border-radius:18px">
<tr><td style="padding:24px 26px;background:#e5f2fd;border-radius:18px 18px 0 0">
<div style="font-size:19px;font-weight:800;color:#0b6198">BotGo</div>
<h1 style="margin:8px 0 0;font-size:23px;line-height:1.35">${title}</h1></td></tr>
<tr><td style="padding:24px 26px 27px;font-size:15px;line-height:1.7">${content}</td></tr>
</table></td></tr></table></body></html>`;
}

export function verificationMessage(code) {
  if (!/^\d{6}$/.test(code)) throw new Error('Invalid verification code');
  return {
    subject: 'BotGo 验证码',
    text: '你的 BotGo 验证码：' + code + '\n10 分钟内有效，请勿转发。若非本人操作，可忽略此邮件。',
    html: emailFrame('邮箱验证码', `<p style="margin:0 0 14px;color:#385970">请将下方验证码填入 BotGo。</p>
<div style="background:#edf6fe;border:1px solid #c8e1f2;border-radius:12px;padding:14px 10px;text-align:center;color:#0a527f;font-size:30px;letter-spacing:5px;font-weight:750;font-family:Consolas,monospace">${code}</div>
<p style="margin:16px 0 0;color:#385970"><strong>10 分钟内有效。</strong> 请勿转发验证码。</p>
<p style="margin:10px 0 0;color:#526e82;font-size:13px">若非本人操作，可忽略此邮件。</p>`),
  };
}

export function shopAlertMessage(title, status, time) {
  const subject = 'BotGo 商城故障提醒';
  const action = '请打开商城检查商品、订单或上游服务状态。';
  const url = 'https://botgo.win/shop';
  return {
    subject,
    text: [subject, title, '状态码：' + status, '发生时间：' + time, action, url].join('\n'),
    html: emailFrame('商城故障提醒', `<p style="margin:0 0 14px;font-size:19px;font-weight:700">${title}</p>
<div style="padding:12px 16px;background:#eef6fd;border-radius:12px;color:#385970">状态码　${status}<br>发生时间　${time}</div>
<p style="margin:16px 0">${action}</p>
<a href="${url}" style="display:inline-block;padding:10px 16px;background:#0b6198;color:white;border-radius:9px;font-weight:700;text-decoration:none">打开 BOTGO 商城</a>`),
  };
}
