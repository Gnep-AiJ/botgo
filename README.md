# BotGo

BotGo 提供网页对话、Windows 桌面工作台与 Agent CLI，共用账户、余额和模型中转。

- 开发接管入口：[项目地图](docs/PROJECT_MAP.md)。
- 目录用途、产物归档与清理：[目录与产物](docs/ARTIFACTS.md)。
- 本地网页：`npm run dev`，访问 http://127.0.0.1:4173；此服务不模拟 Worker API。
- 检查：`npm test`、`npm run check`。
- 桌面开发：`npm --prefix desktop start`。
- CLI 开发：`node agent/bin/botgo.cjs --help`。
- 发布：[DEPLOYMENT.md](DEPLOYMENT.md)；当前证据：[2026-09-12 发布记录](docs/notes/Release%202026-09-12.md)。

安装 CLI 的官网入口为 `https://botgo.win/install.ps1`。生产可用性以发布记录中的实际验证为准。
