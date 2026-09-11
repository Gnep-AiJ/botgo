# BotGo Desktop（Windows）

BotGo Desktop 仅面向 Windows。它通过 BotGo 邮箱验证码登录，在用户选择的本地项目中运行 Codex 任务。

## 发布前配置

打包环境必须提供已部署的 Pages 根地址，且不得带 `/api` 后缀：

```powershell
$env:BOTGO_API_ORIGIN = 'https://your-botgo-pages-domain.example'
npm --prefix desktop run package:win
```

应用会请求 `${BOTGO_API_ORIGIN}/api/...`，并为 Codex 配置 `${BOTGO_API_ORIGIN}/api/v1`。不要填写 Worker 内部地址、`localhost` 或 IP 地址。

## 本地检查

```powershell
npm install --prefix desktop
npm --prefix desktop test
npm --prefix desktop run check
```

## 发布边界

- 首次运行会检测 Codex。缺失时会尝试安装固定的 `@openai/codex@0.91.0`。
- 现有 Codex 配置只有在用户确认后才会备份和替换；账户页可恢复该备份。
- 登录设备凭据与 Desktop Key 仅保存于 Windows DPAPI 保护的应用数据目录；任务历史不保存凭据。
- 未配置 Pages 域名、未部署 Worker 迁移或未完成 Windows 安装包验证时，不得发布。
- 发布前应从实际安装的 `@openai/codex` 包复制其 `LICENSE` 与 `NOTICE` 文件到安装包资源目录，并完成 Windows 代码签名。
