# BotGo 原生 OpenCode 候选

状态：构建、真实登录界面、原生单文件读写、生产网关计费及隔离安装已通过。最终预览包发布进行中，完整能力矩阵尚未验收。证据见 [重建记录](../docs/notes/OpenCode%20Rebuild.md)。

## 本机入口

在项目根运行：

```powershell
npm run opencode:prepare
npm run opencode:build
npm run opencode:verify
npm run opencode:start
```

`prepare` 校验并应用覆盖层；`build` 执行类型检查、原生 server 编译和 Electron 构建。`verify` 启动真实候选的隔离登录窗口，截图后退出，不含模型凭据、不发推理请求。结果位于 `artifacts/verification/opencode-native/<时间戳>/`。即使 Electron fatal 返回 0，没有成功 UI 结果也判失败。它不是完整交互测试入口。

用户本机 `verify` 已通过，结果和截图见 `artifacts/verification/opencode-native/1789371654906/`；不再要求重复同一诊断。此前自动化启动失败的具体环境原因仍未确定。

`start` 是持续交互入口，不自动截图退出。其固定隔离数据目录为 `artifacts/verification/opencode-preview/profile`，包含 OS 加密设备凭据和本地任务，勿删除或分享。不会导入旧客户端数据。首次点击登录会打开 BotGo 网站，真实登录需用户本人确认；执行模型任务可能扣费。线上新网关尚未确认部署，因此当前不能保证登录后可进入任务界面。新增入口构建输入及语法通过；自动化环境运行仍报 GPU 子进程 `0xC0000135`，未通过交互验收。仅检查输入使用 `node opencode-desktop/start.mjs --check`，不要依赖 npm 转发该参数。

## 结构和前置条件

- 固定上游 OpenCode 1.18.30，commit `3104c1428ec91f809e5ab86631300de41eb6952e`，保留 MIT 版权与许可证。
- `artifacts/verification/opencode-bootstrap/local-source/opencode-3104c1428ec91f809e5ab86631300de41eb6952e` 保留原始解压副本；`artifacts/opencode` 为短路径构建副本。两者需要 `extraction-report.json`。重建解压使用 `scripts/extract-opencode-local.py`（先查看 `--help`，短路径选 `--short`）。脚本不覆盖已有目标；链接展开副本不自动跟随目标变化。
- 本地 Bun 1.3.14 位于 `artifacts/verification/opencode-bootstrap/build-tools/node_modules/@oven/bun-windows-x64/bin/bun.exe`。上游依赖已使用 `--frozen-lockfile --ignore-scripts --linker hoisted` 安装；跳过安装脚本意味着原生绑定仍需实际运行验证。
- Electron 42.3.3 已通过 `install-electron-local.mjs` 从用户 ZIP 校验安装。归档哈希和来源局限见重建记录；构建不运行上游自动下载 CLI 的 prebuild。
- `prepare.mjs` 是覆盖层入口，原始源码及目标哈希不符时停止，不覆盖用户修改。不要直接修改忽略目录中的构建源码；在覆盖层修复后重新构建。
- `overlay/` 包含原生主进程适配、登录门禁、品牌及账户面板；`runtime/authorize.cjs` 实现授权，`runtime/bridge.cjs` 实现主进程鉴权代理。保留原生 Agent 和 UI，不使用旧 Codex 桌面冒充新应用。
- 每个账户的数据和任务映射隔离；设备凭据存 Electron safeStorage。上游 Key 不放入源文件、渲染器、包或日志。

## 验证与限制

根检查：`npm test`、`npm run check`、`git diff --check`。桥和授权测试包含在 `pretest`；真实桌面类型检查包含在 `opencode:build`。

登录后点击标题栏 BotGo 按钮，或使用 `Ctrl+Shift+B` 打开账户。模型 context/output 默认安全上限 128,000/8,192 不是已核验的供应商最大值。

打包：`powershell -File opencode-desktop/package.ps1`，复用已有非导出预览签名。`live-check.cjs --live` 是两次真实收费网关探测；`acceptance.cjs --live` 是单文件权限范围内的原生读写验收。二者只在明确要求线上验收时运行，不自动重放失败请求，也不打印密钥。

原生登录、模型/账本端到端、Skills/MCP/子代理、中文路径、停止/恢复、外部 server/WSL 路径限制、原生依赖、签名更新及干净安装均待验证或补齐。已禁用上游更新，不应将此候选设为生产下载；当前没有经过验收的新安装包。
