# BotGo 支付宝网站支付

Checkout now returns a signed `paymentUrl` for a browser GET navigation. The client uses this URL first because browser CSP can block a cross-origin HTML form POST even when the payment gateway is otherwise configured correctly. The signed `paymentHtml` form remains in the response as a compatibility fallback.

Worker 使用支付宝 `alipay.trade.page.pay` 和 Web Crypto 原生 RSA2 签名，不依赖 Node.js `alipay-sdk`。私钥只作为 Cloudflare Worker Secret 使用，不能写入仓库、日志或普通变量。

## 生产配置

`worker/wrangler.jsonc` 只保存非敏感占位配置：`YOUR_ALIPAY_APP_ID`、RSA2、支付宝网关，以及示例回调 `https://your-domain.example/api/billing/notify` 和 `https://your-domain.example/api/billing/return`。部署前在本地或 CI 换成你自己的 16 位 App ID 和 HTTPS 回调，不要把真实 App ID 或商户域名提交进仓库。D1 `database_id` 同样只保留全零占位 UUID，真实 id 从 Cloudflare 控制台或 `wrangler d1 create` 取得后在本地填写。以下值必须通过 Cloudflare Secret 配置：

```text
ALIPAY_PRIVATE_KEY   # 应用私钥，支持 PKCS#1 或 PKCS#8 DER/PEM 内容
ALIPAY_PUBLIC_KEY    # 支付宝公钥（不是应用公钥）
ALIPAY_SELLER_ID     # 商户号；也可以改用 ALIPAY_SELLER_EMAIL
```

支付宝公钥模式和证书模式不能混用。证书模式必须同时提供 `ALIPAY_APP_CERT`、`ALIPAY_PUBLIC_CERT`、`ALIPAY_ROOT_CERT`。

## 本地检查

```powershell
node tests/alipay-payment.test.mjs
npm run check
npx --yes wrangler@4.125.0 deploy --config worker/wrangler.jsonc --dry-run
```

测试只使用临时生成的 RSA 密钥，不接触生产 Secret。测试通过只证明签名、验签、金额校验和网关响应解析正确，不等于支付宝真实付款成功。

## 真实支付验收

1. 在支付宝开放平台确认生产应用已开通网站支付，并确认应用公钥与应用私钥属于同一套生产密钥。
2. 在 Cloudflare 设置上述 Secret 后部署 Worker。
3. 账户页面选择 ￥10、￥50、￥100 或不低于 ￥10 的自定义金额，在支付宝页面完成付款。
4. 以验签通过的异步通知或服务端 `alipay.trade.query` 结果为准确认订单；浏览器回跳本身不能作为付款凭据。
5. 验收完成后确认账户余额增加的金额与订单金额一致，且不会创建或续期 Pro 订阅。

支付宝登录、实名/签约、验证码和真实付款必须由商户手动完成，Agent 不能代办。
