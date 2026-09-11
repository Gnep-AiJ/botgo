# BotGo 发布说明

## Cloudflare 资源

1. 使用现有 D1 数据库 `botgo`，依次应用 `worker/migrations/0001_initial.sql` 至 `0011_upstream_routes.sql`。
2. 使用 `worker/wrangler.jsonc` 部署 `botgo-api` Worker。
3. 在 Worker 中交互式设置 `AUTH_SECRET`、`UPSTREAM_CONFIG_KEY`、`UPSTREAM_API_KEY`、`ADMIN_EMAIL`、`QQ_SMTP_USER` 与 `QQ_SMTP_AUTH_CODE`。`UPSTREAM_CONFIG_KEY` 必须是 32 字节随机值的 base64url 编码，用于加密管理后台保存的上游密钥。旧的 `UPSTREAM_API_KEY` 仅作为迁移期回退；密钥不得写入仓库、命令参数或日志。
4. `wrangler.toml` 将 Pages Function 通过 `BOTGO_API` Service Binding 连接到私有 Worker。
5. 创建私有 R2 bucket `botgo-desktop-releases`。不要开放 `r2.dev`；安装包只通过 Worker 的短时签名下载接口输出。

## 管理后台

- 网页对话与桌面 Codex 使用独立路由。新上游必须分别通过 Chat Completions 或 Responses 真实能力测试，才能切换对应路由；系统不自动故障转移。
- 首次升级可在“上游与路由”中导入 Worker 当前回退配置，随后分别测试并绑定两条路由。上游地址、模型映射和密钥不向用户端展示。
- Pro 套餐固定为 30 天一期，价格和本期额度可配置。人工续期开通会重置本期额度，不累计旧额度，并从当前有效期末续 30 天。
- 支付宝签名、同步跳转和异步通知尚未实现，因此用户端购买必须保持禁用。仅配置密钥不能视为支付可用。
- 桌面端先将安装包上传到私有 R2，再用 `npm --prefix desktop run release:metadata -- <installer.exe>` 计算元数据，最后在后台登记并发布。

## 发布与验证

```powershell
npm run check
npm test
npm run deploy
```

- 生产网站使用 `botgo.win`，模型固定为 GPT-5.6。
- 部署后验证健康接口、邮箱验证码登录、一次流式对话与额度刷新。
- Windows 安装包使用最大压缩和文件白名单，但 Electron 运行时决定了体积不会大幅下降。当前安装包未签名，只适合受控内测；公开发布前必须完成代码签名和干净 Windows 机器安装验证。

## 当前受控发布

- Worker 版本：`426fbd35-4ca3-4221-a76d-734c3479c60d`。
- Pages 验证部署：`https://21288a8e.botgo.pages.dev`，生产域名：`https://botgo.win`。
- 当前已发布桌面版本仍为 `1.0.0`；新版源码版本为 `1.0.1`，必须在双路由和安装验证通过后再上传并发布。
- 安装包 SHA-256：`0d0a918995f4b75d52cf2592067a0447bb18cb49d4a7aa164f4ae9d786273110`。
- 支付宝应用审核期间，购买入口保持禁用，应用私钥不上传 Worker。
