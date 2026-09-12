# BotGo Desktop（Windows x64）

极简对话界面，使用 BotGo 账户与计费，实际执行基于 Codex CLI。

开发：先 `npm ci --prefix agent`、`npm ci --prefix desktop`，再 `npm --prefix desktop start`。打包必须设置 `BOTGO_API_ORIGIN=https://botgo.win`，执行 `npm --prefix desktop run package:win`。

独立 Codex 配置位于 Electron userData 的 `codex/`，不替换个人 `.codex/config.toml`。桌面随包携带 `agent/` 的共用运行器和固定 Windows Codex 二进制；无需全局 Node/Codex。

设备凭据使用 safeStorage；原生终端入口只通过环境变量传递执行凭据。退出设备在服务端撤销设备权限。

架构、会话迁移与验证见 [模块地图](../docs/notes/Desktop%20and%20CLI.md)。实际发布状态见 [当前发布记录](../docs/notes/Release%202026-09-12.md)。
