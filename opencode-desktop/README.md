# BotGo 原生客户端

当前发布：BotGo 1.3.9，固定 OpenCode 1.18.35。生产更新记录、签名与 R2 完整下载已核验；PDF、原生配置和界面验收范围见 [当前发布记录](../docs/notes/Release%202026-09-14.md#2026-10-10-native-pdf-adaptation-and-pinned-upstream-upgrade--139)。

## 本机入口

在项目根运行：

```powershell
npm run opencode:prepare
npm run opencode:build
npm run opencode:verify
npm run opencode:start
```

`prepare` 校验并应用覆盖层；`build` 执行类型检查、原生 server 编译和 Electron 构建。`verify` 启动真实候选的隔离登录窗口，截图后退出，不含模型凭据、不发推理请求。结果位于 `artifacts/verification/opencode-native/<时间戳>/`。即使 Electron fatal 返回 0，没有成功 UI 结果也判失败。它不是完整交互测试入口。

`start` 是持续交互入口，不自动截图退出。其固定隔离数据目录为 `artifacts/verification/opencode-preview/profile`，可能包含 OS 加密设备凭据和本地任务，勿删除或分享。不会导入已安装客户端数据。首次登录会打开 BotGo 网站，执行模型任务可能扣费。仅检查输入使用 `node opencode-desktop/start.mjs --check`。

## 结构和前置条件

- 上游版本、commit 和目录统一取自 `upstream.json`，保留 MIT 版权与许可证。当前 commit 为 `53d1eabb61e21162157817bf677da0a4ad3332e3`。
- `artifacts/verification/opencode-1.18.35-upgrade/original` 是原始解压副本，`artifacts/opencode-1.18.35` 是构建副本。两者需要 `extraction-report.json`。`scripts/extract-opencode-local.py` 默认使用固定原始路径，`--short` 使用固定构建路径，`--destination` 可指定 artifacts 内的新隔离目录。脚本不覆盖已有目标。
- 本地 Bun 1.3.14 位于 `artifacts/verification/opencode-bootstrap/build-tools/node_modules/@oven/bun-windows-x64/bin/bun.exe`。上游依赖已使用 `--frozen-lockfile --ignore-scripts --linker hoisted` 安装；跳过安装脚本意味着原生绑定仍需实际运行验证。
- Electron 42.3.3 的官方归档校验结果位于本次升级证据目录；`install-electron-local.mjs` 安装到固定构建副本。构建不运行上游自动下载 CLI 的 prebuild。
- `prepare.mjs` 是覆盖层入口，原始源码及目标哈希不符时停止，不覆盖用户修改。不要直接修改忽略目录中的构建源码；在覆盖层修复后重新构建。
- `overlay/` 包含原生主进程适配、登录门禁、品牌及账户面板；`runtime/authorize.cjs` 实现授权，`runtime/bridge.cjs` 实现主进程鉴权代理。保留原生 Agent 和 UI，不使用旧 Codex 桌面冒充新应用。
- 每个账户的数据和任务映射隔离；设备凭据存 Electron safeStorage。上游 Key 不放入源文件、渲染器、包或日志。

## 验证与限制

根检查：`npm test`、`npm run check`、`git diff --check`。桥和授权测试包含在 `pretest`；真实桌面类型检查包含在 `opencode:build`。

标题栏文字 Logo 打开官网，右侧账户按钮或 `Ctrl+Shift+B` 打开账户。仅 BotGo 供应商可用；模型能力和限制由已验证路由下发，未知型号的 128,000/8,192 是安全默认值。

打包：`powershell -File opencode-desktop/package.ps1`，复用已有非导出预览签名。`live-check.cjs --live` 是两次真实收费网关探测；`acceptance.cjs --live` 是单文件权限范围内的原生读写验收。二者只在明确要求线上验收时运行，不自动重放失败请求，也不打印密钥。

无付费配置验收：`node opencode-desktop/audit.mjs`、`node tests/run-native-pdf.mjs --links-only`。后者检查实际内核版本、BotGo 模型、项目权限/MCP/子代理配置、终端、账户和官网跳转，不调用上游。PDF 上游验收只使用合成文件和显式授权的测试凭据。当前未验证现有安装数据的原地升级、生产账户实际扣费和每一个上游模型；具体证据及限制以当前发布记录为准。

上游升级只做人工适配；客户端使用 BotGo 签名更新。旧构建和解包目录可清理，当前固定源码/依赖、签名身份、账户数据、现行安装包及必要回滚包必须保留。
