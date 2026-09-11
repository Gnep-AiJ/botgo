---
type: release-note
project: BotGo
status: production
date: 2026-09-10
tags: [botgo, release, cloudflare, r2, d1, desktop]
---

# BotGo 生产发布 2026-09-10

上级入口：[[../PROJECT_MAP|BotGo 项目地图]] · [[../README|文档入口]] · [发布说明](../../DEPLOYMENT.md)

## 发布结果

- 生产站点：<https://botgo.win>
- Pages 验证部署：<https://21288a8e.botgo.pages.dev>
- Worker：`botgo-api`，版本 `426fbd35-4ca3-4221-a76d-734c3479c60d`
- D1：`0008_upstream_profiles.sql`、`0009_billing.sql`、`0010_desktop_releases.sql` 已应用
- R2：私有 bucket `botgo-desktop-releases`
- 桌面端：`1.0.0` 受控内测，未签名
- R2 对象：`win/BotGo-Desktop-Setup-1.0.0.exe`
- 文件大小：`88,395,571` 字节
- SHA-256：`0d0a918995f4b75d52cf2592067a0447bb18cb49d4a7aa164f4ae9d786273110`

## 已验证

- `npm run check`、`npm test` 和全部桌面端测试通过。
- 生产首页、工作台和 `/api/health` 返回 HTTP 200。
- Pro 套餐公开接口返回 30 天、9900 分、1000 额度，`paymentAvailable=false`。
- 未登录访问桌面下载返回 401；未授权访问管理接口返回 403。
- 远端 R2 安装包与本地构建的字节数和 SHA-256 完全一致。
- 首页已移除无入口的旧案例弹层及四张案例图片引用。

## 安全边界

- 支付宝应用仍在审核，购买入口保持禁用。
- 支付宝公钥和应用私钥仅保存在被 Git 忽略的 `.secrets/`；本次未上传应用私钥。
- 上游加密主密钥已作为 `UPSTREAM_CONFIG_KEY` Worker Secret 配置，文档不记录其值。
- R2 bucket 不公开，只允许 Worker 经登录态和短时签名链接下载。
- 当前 Windows 安装包没有 Authenticode 签名，只允许受控内测。

## 整理记录

- 历史 `docs/superpowers` 决策已汇总进 [[../PROJECT_MAP]] 后删除。
- 已删除 `.skill-archive`、临时开发日志、Wrangler 缓存、旧构建目录和过期清理脚本。
- 保留 `.agents`、`.codex`、`.claude`、`.secrets`、当前源码、迁移、测试和桌面证据。

## 后续入口

- 支付宝审核通过：补充 AppID，完成 RSA2 下单、异步通知验签和主动查询。
- 桌面端公开发行：完成代码签名和干净 Windows 机器安装验证。
- 工作台视觉修改：[[UI Workspace]]。
- 本地预览：[[Dev Preview]]。
