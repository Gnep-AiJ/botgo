# BotGo Desktop V1 证据快照

日期：2026-08-30（Asia/Singapore）

## 当前产物

- Windows 安装包：`desktop/dist/verify-taskbar-icon/BotGo Desktop Setup 1.0.0.exe`
- 大小：88,402,509 bytes
- SHA-256：`82A895BFA6554B32C91B79FE85D06A55E6D2F9D30FF8981C23A15CB9A8B1F8F8`
- 当前免安装测试应用：`desktop/dist/verify-taskbar-icon/win-unpacked/BotGo Desktop.exe`

## 已验证

2026-08-30 运行 `npm test`，以下检查通过：

- 网站工作区、Codex 中转、后台与首页合约。
- Desktop 设备凭据、浏览器授权、运行时边界、任务执行器与 UI 合约。

## 已发布链路

- D1 迁移：`0005_desktop_devices.sql`、`0006_desktop_web_authorizations.sql` 已应用。
- Worker 版本：`935b53fe-dbb4-4176-858d-9931de06709f`。
- Pages 授权页：`https://botgo.pages.dev/desktop-authorize`。

## 版本控制状态

- 基础提交：`738a5619dc98fe92059ca7617cecbc2d727bf868`。
- GitHub remote：`https://github.com/<owner>/botgo.git`。
- GitHub CLI 已授权，仓库可见性已确认私有。
- 本次仅提交 BotGo 产品代码、桌面工程与证据；本地工具目录不删除、不提交。
