# BotGo

BotGo 提供 Windows 桌面客户端。网站提供产品展示、客户端下载、账户管理、充值和百科、医生、塔罗牌 Web 对话，复用现有账户、已验证模型路由和计费。项目执行在客户端运行，CLI 安装入口已停止提供。

- 项目结构：[项目地图](docs/PROJECT_MAP.md)
- 本地网站：`npm run dev`，访问 http://127.0.0.1:4173
- 检查：`npm test`、`npm run check`
- 客户端开发：`npm run opencode:prepare`、`npm run opencode:build`
- 发布流程：[DEPLOYMENT.md](DEPLOYMENT.md)
- 公开占位：D1 id、支付宝 App ID、支付回调、反馈邮箱和签名指纹都不是真实值。部署前在本地或 CI 替换，不要把商户或个人信息提交进仓库。

生产可用性以实际发布和当前安装包验证为准。

Web 对话联调时，先启动已配置的本机 Worker，再在网站终端设置本机 API 地址：

```powershell
$env:BOTGO_DEV_API_ORIGIN = 'http://127.0.0.1:8787'
npm run dev
```

访问 http://127.0.0.1:4173/chat.html。未设置该变量时仅预览页面，账户请求会提示未连接后端。代理只允许本机 HTTP 地址；生产环境仍使用 `functions/api/[[path]].js` 的 `BOTGO_API` 服务绑定。

对话支持重命名、草稿保留和手动重试。草稿按账户、模式和对话存于当前标签页会话，退出时清理；浏览器无法保存时会提示。重试先读取已保存状态，已完成则恢复回答，仍在生成或状态读取失败则不重新调用模型。手动标题最多 40 个字，沿用 30 天保留规则；发布前需应用新增迁移 `0030_web_conversation_titles.sql`。

联网由模型按需选择，输入区无需手动开启。生图同样由聊天模型按需调用，无单独开关或设置；支持私有图片历史、预览下载和失败重试；刷新后仍在运行的回答也可停止。图片与消息均按 30 天保留。后端取消、计费与加密存储说明见 [Web 生图与停止](docs/WEB_CHAT_IMAGES.md)，新增迁移为 `0031`、`0032`。

`npm run test:web-ui` 使用临时 SQLite 和测试邮件/模型传输，验证真实 Pages/Worker 入口、登录 Cookie、模型、历史、牌阵与账本；不会发送邮件或调用付费接口。需要本机 Chrome 和 Playwright，可通过 `BOTGO_CHROME_PATH`、`BOTGO_PLAYWRIGHT_PATH` 指定现有安装位置。证据保存在 `artifacts/verification/web-chat/`。
