# BotGo

BotGo 提供 Windows 桌面客户端。网站用于产品展示、客户端下载、账户管理和充值。模型任务在客户端运行；网页不提供对话或 CLI 安装入口。

- 项目结构：[项目地图](docs/PROJECT_MAP.md)
- 本地网站：`npm run dev`，访问 http://127.0.0.1:4173
- 检查：`npm test`、`npm run check`
- 客户端开发：`npm run opencode:prepare`、`npm run opencode:build`
- 发布流程：[DEPLOYMENT.md](DEPLOYMENT.md)
- 公开占位：D1 id、支付宝 App ID、支付回调、反馈邮箱和签名指纹都不是真实值。部署前在本地或 CI 替换，不要把商户或个人信息提交进仓库。

生产可用性以实际发布和当前安装包验证为准。
