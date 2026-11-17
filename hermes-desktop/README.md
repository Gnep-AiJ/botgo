# BotGo Hermes preview

独立的 Windows 验收客户端；不替换已发布的 OpenCode 客户端。

- 内核固定在 `upstream.json` 的 Hermes commit，保留 MIT 许可。
- `prepare.mjs` 从固定快照生成 `artifacts/hermes/`，禁止手工修改生成目录。
- 登录、余额和计费模型复用 BotGo 服务；设备凭证使用 Windows 加密存储。每个账户使用独立的 Hermes home。
- 保留原生 Gateway、工具、记忆、Skills、MCP、机器人和消息渠道。微信入口使用原生 Weixin/iLink。
- 更新复用 BotGo 下载、摘要与签名校验，保留原生任务排空和安装保护。登录后启动检查、每六小时复查；Hermes 与 OpenCode 独立发布通道，禁止混装内核。

## 构建

需要 Node 24+、固定快照、已准备的原生依赖、Python 与工具环境。

```powershell
node hermes-desktop/prepare.mjs
node hermes-desktop/build.mjs
powershell -File hermes-desktop/package.ps1
# 生成安装程序：追加 --installer
```

打包需要现有 BotGo Windows 签名身份。第三方运行时保留原始字节与签名。

## 手动验收

先退出旧客户端，再运行 `artifacts/releases/hermes-preview-polish/win-unpacked/BotGo.exe`，核对“关于”的版本，保留同目录全部文件。新旧包共用原验收账户目录，账户和聊天数据不迁移、不清空。

1. 登录，核对账户和模型；执行本机文件任务，核对结果和实际扣费。
2. 打开“消息平台”→ WeChat / QQ Bot →“扫码连接”，在手机确认；发送任务并检查实际收发。电脑和 BotGo 客户端需要保持运行。Email 仍需邮箱授权信息；当前扫码连接默认机器人。
3. 重启，检查账户、会话、微信恢复；切换账户检查数据隔离。
4. “关于”→“检查更新”。已验证真实下载、摘要与固定签名；自动原位重启安装仍需手验。

打包使用原生 sealed payload 清单和 Windows 启动器，依赖位于 `venv/Lib/site-packages`。必须验证包内 Python 的 Gateway 冷启动和重启；只检查 Python import 或登录窗口不足以证明后端可用。

默认数据位于 `%APPDATA%/BotGoHermesPreview`。生产授权、计费、微信扫码和在线更新需要单独验收，本地模拟测试不能替代。

精简版不展示未接通的 Live 语音、外部模型账号或自定义模型入口。Live 能力尚未验证，不会自动发送付费语音请求。机器人是独立身份和配置的长期助手，复用固定聊天；普通会话是按任务分开的上下文。

证据：`artifacts/verification/hermes-acceptance/` 和 `artifacts/verification/hermes-electron/`。

余额常驻侧栏；点击进入账户，可充值、查看账单或刷新。设置默认展示常用分类和少量字段，其他选项折叠。侧栏移除“技能与工具”，原生 `skills_list`、`skill_view`、`skill_manage` 和 MCP/插件实现保持原样；外部服务授权仍遵循原生权限流程。版本信息统一在 BotGo“关于”页查看。

原生 `image_generate` 通过 BotGo 已验证图片模型生成、保存图片并按当前会话计费，无单独界面入口或额外密钥。当前支持文字生图，不宣称支持编辑。2026-10-23 已实际验证 Sunburst 生图和 Sol 识图；其他模型、视频和 PDF 完整客户端链路需分别验收。

记忆、用户画像、后台自我改进、自动压缩沿用原生默认开启；SOUL.md 自定义内容不覆盖，仅迁移未修改的上游身份模板。压缩是有损摘要，不能视为无限上下文。主动消息通过原生定时任务和已绑定平台投递，电脑与客户端需运行；不自动创建推送任务。

Windows 默认通过原生 `text_to_speech` 插件调用系统语音包生成 WAV，无单独入口、密钥或扬声器自动播放；用户已指定的其他 TTS 提供方保留。2026-10-24 已实测 GPT-6.1-sol 调用工具生成 3.76 秒中文音频。目标电脑需有对应语言的 Windows 声音。微信原生适配器将音频作为文件附件发送，语音气泡及真实联系人投递未验收。GPT 上游音频输入返回 HTTP 400，speech 路由 404，Edge 在线服务 403；Live 和这些未接通的链路继续隐藏。

载荷同时包含主应用依赖与独立 `pm-runtime`，原生 Skills/插件的可选依赖安装通过锁定的包管理运行时执行，不跳过完整性校验。Sealed PM 按原生设计移除 Windows venv 重定向器，通过 `pm.runtime.runtime_command` 启动。

安装验收采用 `artifacts/verification/botgo-installed-v5/`，失败候选及日志保留。安装器固定官方旧工具链 `toolsets.nsis: 0.0.0`，使用 ZIP 提取并关闭原生差量归档；同一有效归档在新 3.12 bundle 插件下提取失败，在旧 Unicode 插件下完整提取成功。BotGo 更新仍下载完整安装包，校验 SHA-256 与固定签名。已验收载荷可以通过 `package.ps1 --installer --installer-only` 只重建安装器。
