---
type: module
updated: 2026-09-14
status: local-partial-blocked
tags: [botgo, opencode, rebuild]
---
# OpenCode 重建：当前实现与继续入口

## 2026-09-14 17:10 客户端优先修复

- 用户要求暂停生图和网页/后台改造，优先客户端上线。
- 生产只读汇总确认：同一账户的旧 Codex 2 条及 Web 1 条 review 导致新客户端触发 `AGENT_REVIEW_LIMIT`；当时无 reserved，新客户端 2 条请求均已结算。没有删除或假核对这些记录。
- 0018 将待核对计数隔离至客户端渠道，保留账户级并发 8、余额预留与财务封锁；已应用生产。Time Travel 书签 `0000010a-00000010-000050e6-8b5a63f9281eeff8a1b6567f0cb83142`，仅为限期回滚依据。
- Worker `e14ea338-70a5-49f3-aeea-c1ab934c491d` 已发布：区分并发 429 / 待核对 409，重复结算不再更新渠道健康。生产触发器回读一致，health 200。保留 AUTO_REVIEW_ENABLED=1，不改变旧客户端兼容开关。
- 新候选 preview.2：BotGo 菜单文案/帮助链接、可见账户按钮、托管服务器选择限制。构建和类型检查通过，证据 `artifacts/verification/opencode-build/1789376783600/`。隔离真实 Electron 登录页截图通过，`artifacts/verification/opencode-native/1789376946225/`。尚不代表登录后 UI、工具和安装包验收。
- `npm test` 首次开发监听测试失败，单独及全量复跑通过；`npm run check`、`git diff --check` 通过。签名安装包正在生成，下载指针未切换，GitHub 未推送。未清理旧源文件或用户数据。

上级：[[../PROJECT_MAP]] · 发布记录：[[Release 2026-09-12]]

## 已确定的边界

- Windows 原生；保留 OpenCode 原生 Agent、子代理、Skills、MCP 与权限行为，不仿造 Codex 专属沙箱和模型自动审核。
- 网站继续 Pages/Workers/D1/R2，不新增 VPS。所有发行客户端模型请求仅走 BotGo；上游密钥不进入客户端。
- 复用邮箱、支付宝、微元账本、默认 0.3 倍率与品牌。原 Codex 客户端、历史、未提交修改及稳定下载入口均保留。

## 本地已实现

- `worker/migrations/0017_opencode_gateway.sql` 是新增迁移，不修改历史迁移或已有金额。增加按模型的 Agent 上游/协议、独立路由健康状态、成本估算字段，以及账户并发/待核对数量限制。
- `worker/src/opencode-gateway.js` 提供设备会话、Chat/Responses 入口、任务汇总及管理员路由/探测。沿用现有加密上游和设备授权。
- `metering.js` 对 OpenCode 使用独立路由隔离，缺失 usage 不虚构收费、不禁用全局模型；原 Codex/Web 路径仍兼容。过期预留释放，单账户最多 8 个未结算请求、3 个未核对记录后拒绝新的 OpenCode 请求。
- 上游地址/密钥或模型映射改变时，数据库触发器使 OpenCode 路由禁用并要求重新探测。价格、汇率、倍率、路由版本保存在每次请求快照中。
- 后台“模型与计费 → OpenCode 渠道”：选择已保存上游、协议、可选成本、保存禁用配置、真实探测、再启用。模型本身仍需在模型目录启用并允许 Agent。
- `workspace-chat.css` 提供简洁聊天阅读面；其他页面和品牌资源保留。新 CSS/JS 已加入构建与内容版本号。

## 接口契约（Worker 路径；经 Pages 时加 `/api`）

| 接口 | 鉴权与行为 |
| --- | --- |
| `POST /desktop/opencode/session` | `bgdt_` 设备凭据；签发 24 小时执行 Key，返回可用模型、协议、默认模型与余额。会撤销该设备原执行 Key，客户端只应在连接准备/过期恢复时调用。 |
| `GET /opencode/v1/models` | 有效设备执行 Key；只返回验证且启用的 Agent 模型。 |
| `POST /opencode/v1/chat/completions` | 有效设备执行 Key；原生 Chat 数据，不伪造 Responses 转换。 |
| `POST /opencode/v1/responses` | 有效设备执行 Key；原生 Responses 数据。 |
| `GET /opencode/usage?taskId=…` | 有效设备执行 Key；仅汇总当前账户对应任务记录。 |
| `GET /admin/opencode` | 管理员；读取路由与健康状态。 |
| `PUT /admin/opencode/models/:id` | 管理员；`profileId, protocol: chat/responses, enabled, costPrice?`。可选成本四项为 USD/百万 token。 |
| `POST /admin/opencode/models/:id/probe` | 管理员；两次真实收费请求，检查流式工具调用、续接和 usage；通过后单独启用。 |

Agent 请求支持 `X-BotGo-Task-Id`（1–128 个字母、数字、下划线或连字符）及既有 `Idempotency-Key`。任务 ID 只用于账户内汇总，不决定价格或权限。本地桥已映射原生 session/parent-session 请求头，按账户持久化根任务映射；夹具通过，真实辅助模型及子代理整链路仍待验证。

上游成本字段是按管理员成本价格表计算的估算，不是供应商实际对账结果。价格仍为既有快照；本轮没有重新核验所有官方价格或证明中转模型身份。

## 已验证与失败证据

- OpenCode 固定 `v1.18.30`，标签 commit `3104c1428ec91f809e5ab86631300de41eb6952e`。
- `python scripts/bootstrap-opencode.py --npm` 下载官方 Windows x64 包并校验固定 SHA-512；运行时位于 `artifacts/verification/opencode-bootstrap/runtime/opencode.exe`。
- 设置隔离 XDG 路径后 `--version` 返回 1.18.30。初次未隔离启动尝试写全局配置时被拒绝；后续全部使用 artifacts 内 profile。
- `scripts/probe-opencode.py` 仅从进程环境读取测试 Key。真实 `gpt-5.6-luna` Chat 返回 usage；原生 Agent 的 apply_patch → read → 回复三轮完成，`native-project/gate.txt` 内容正确。原始最小 Chat 输入计费 6607 token，不能以用户文本长度推断价格。
- 脱敏结果：`artifacts/verification/opencode-bootstrap/live-result.json`。不包含测试密钥；本轮文本日志/配置密钥模式扫描为 0 条。
- `tests/opencode-gateway.test.mjs` 使用真实 SQLite 迁移、设备签发/撤销和加密上游配置；推理 HTTP 使用夹具。覆盖双协议、账本、重复结算、路由隔离、配置失效、原子限制、Key 过期及设备撤销。这不是生产登录/扣费证据。
- `tests/opencode-ui.cjs` 已提供，但本机 Electron GPU 子进程 `-1073741515`，页面加载 `ERR_FAILED`，未生成成功截图。失败记录在 `artifacts/verification/opencode-ui/failure.txt`。
- 源码归档和隔离 Git 下载停滞；两次更小范围的提升下载申请均被自动审批服务 503 拒绝。备用浏览器入口也被同一审批服务 503 拒绝。没有绕过拒绝。

## 2026-09-14 原生桌面推进（替代此前源码下载阻碍）

- 用户提供的源码归档已完整解压，60 个符号链接展开为副本，6,630 个输出文件与归档内容 SHA-256 一致。原件及 `extraction-report.json` 保留。归档 SHA-256：`4b5f2e5edfc796082a353fd09c1b1dec3e7a108a4b080fe3a86b12d9fa59fae6`；这不是独立官方来源认证。
- 实际构建路径为 `artifacts/opencode`，Bun 1.3.14 以 frozen lockfile、hoisted linker 安装依赖。短路径解决此前 ENAMETOOLONG；链接副本不会自动同步，修改必须经覆盖层处理。保留上游 MIT 许可。
- 用户下载的 Electron 42.3.3 ZIP 已完成，SHA-256 与 npm 包校验表一致：`d204d1aaf76e80db6102c482a2f7cc6d20c6c570e9ac6ac5bfee61155467e6a0`。本地安装及 `--version` 通过；无需继续等待 `.crdownload`。
- `opencode-desktop/prepare.mjs` 校验原始源码及已有覆盖层哈希，应用 25 个文件的覆盖层，拒绝覆盖未识别修改。BotGo 图标/名称、独立应用 ID、登录门禁、safeStorage 设备凭据、本地鉴权桥、双协议、账户费用面板及退出重启均已编码。
- 本地桥持有云执行 Key，渲染器仅获得随机本地桥凭据；包含协议/model 白名单、浏览器 Origin 拒绝、请求上限、断流取消、23 小时单飞刷新和禁止自动请求重放。模型默认 context/output 安全上限为 128,000/8,192，**不是已验证的上游能力**。
- 启动已修复为先显示窗口再等待登录，并保持初始化 fiber 生命周期。原生 Agent 循环保留，BotGo provider 禁止原生处理器自动重试。上游自动更新禁用，BotGo 签名更新尚未接入。
- `artifacts/verification/opencode-build/1789371062947/result.json` 记录 prepare、桌面类型检查、原生 Node server 与完整桌面构建通过；明确 `visualVerified:false`、`productionVerified:false`。桥与授权测试、上游 61 项 retry 测试及根 `npm test`、`npm run check` 已通过。
- 实际 Electron 在渲染前报 GPU 子进程 `-1073741515 / 0xC0000135`，随后 `GPU process isn't usable. Goodbye.`；初次隔离目录为 `artifacts/verification/opencode-native/1789369494200/`，没有成功截图。具体缺失/不可访问 DLL 未定位，不能断言显卡驱动或沙箱是原因。
- 提升权限的窗口验证在执行前被自动审核通道 HTTP 503 拒绝，请求 ID `af212bcf-6126-4262-9be3-59a6085e7b2a`；没有绕过。生产 health/models 的只读请求本地报 EACCES，不能确认线上状态。

## 必须继续的工作（当前）

- 2026-09-14 16:12：生产 D1 已以 Time Travel 书签保留回滚点并成功应用 0017；兼容 Worker `16e89f3b-0427-4928-bd93-b86bd6b9ca82` 与 Pages `f7e8778e-d7ec-4aca-bea9-ba84d08de020` 已部署。现网 Codex 自动审批开关保持为 1，稳定客户端下载未切换。公开健康、未登录鉴权和静态文件哈希回读通过。
- 部署后启动持续交互候选，`botgo-auth` 在 session 阶段返回 HTTP 503。OpenCode 模型渠道仍需由管理员保存、真实探测并启用；在此之前客户端不能进入真实任务验收，也不能打包发布。浏览器视觉和已登录后台操作由用户自行验收。
- 后续已通过受控维护脚本为 Terra、Luna、Astra 保存 Responses 路由；每个模型均完成两次真实 SSE 工具调用、续接及终态 usage 探测后才启用。重新启动候选后生产 session 成功，sidecar ready，默认项目创建完成；客户端窗口已交由用户执行真实功能验收。安装包、签名更新和稳定下载切换仍未执行。

### 登录失败与客户文案修复追加

- 用户确认浏览器登录后才在客户端报错；本地 `opencode-preview/profile/device.enc` 存在且时间为 2026-09-14 15:48:23，只检查元数据，未读取密钥。支持凭据已保存、后续连接失败的判断；没有服务端状态码证据，不能把未部署网关或网络故障认定为已证实根因。
- 删除登录页内部凭据/上游说明及中英文翻译，服务不可用不再统一提示客户检查网络。主进程新增 allowlist 脱敏日志，仅包含阶段、HTTP 状态和固定错误类别；不记录 URL、响应正文、密钥或原始异常。日志位于当前 profile 的 `logs/<时间>/botgo-auth.log`。
- 构建 `artifacts/verification/opencode-build/1789372417034/`、全量 `npm test`、`npm run check` 及诊断专项测试通过。修改后的页面尚未实际渲染验收，真实登录尚未修复验证；不要再次把局部构建称为完整交付。
- 用户明确授权先备份 D1、核对/应用 0017、部署兼容 Worker 和后台、配置测试渠道，保留旧账户支付数据及稳定下载入口。首次只读提升检查仍被审批服务 HTTP 503 拒绝，ID `f0b17bad-3eb9-4db3-889b-f070a58726f2`；未执行备份、远程迁移或部署。必须先恢复审核通道才能继续授权的线上操作，未绕过拒绝。
- 用户另授权清理旧开发/已部署客户端。先解除新候选对旧 `desktop/` 的构建依赖：凭据存储实现保留在新 runtime，ICO 保留在新 overlay，图标 SHA-256 与原件一致。旧客户端、安装数据及下载对象尚未删除；需逐一确认路径和引用后可恢复地归档，不清理支付/邮箱/品牌/账户数据/Git 历史。当前根测试仍覆盖旧兼容路径，不因清理意图删除必要回归。

1. 用户本机 `npm run opencode:verify` 已通过，已读回 `artifacts/verification/opencode-native/1789371654906/result.json` 并查看 `desktop.png`：1280×800 深色登录页、Logo/标题正常、无报告脚本错误。此前 GUI 阻碍不再阻止本机测试；不代表已登录或完整桌面验收。日志有开发模式 CSP 安全警告，需在发行前核对。新增 `npm run opencode:start` 为持续交互入口，尚待实际运行验收；覆盖层关闭默认远程调试 9222 端口。
2. 验证真实登录 → 原生任务 → BotGo 网关 → 账户费用，覆盖取消、刷新及断线，不以夹具代替真实扣费。核对跳转外部服务/WSL 等入口不能绕过发行客户端的 BotGo-only 边界。
3. 完成 Windows 命令、中文路径、恢复、停止、权限、子代理、Skills、MCP 与原生依赖矩阵；完成亮暗主题、键盘及账户弹窗实际视觉验收。
4. 接入签名更新、生成 Windows 候选包、干净安装验证；尚无已验证的新安装包。保留旧客户端和稳定下载入口。
5. 完成 Web/后台浏览器验收及 Workers 真实运行时测试。生产迁移/部署需要明确授权和 D1 备份；没有执行远程迁移、部署、上传或下载指针切换。

构建及检查入口见 `opencode-desktop/README.md`。以下记录为源码获取刚解除时的历史待办，不代表当前代码状态。

用户回传窗口结果后，再次只读检查生产 health/models：普通执行 EACCES，提升申请仍在执行前被审批服务 HTTP 503 拒绝，请求 ID `b151faed-ef5e-475e-9375-3e272dbbef8c`。没有绕过拒绝、发推理或修改生产。真实云端联调仍需恢复审批/网络权限；真实登录需要用户本人确认。

交互入口追加验证：完整构建 `artifacts/verification/opencode-build/1789371891539/` 通过；根 `npm test`、`npm run check`、新增入口语法及直接 `node opencode-desktop/start.mjs --check` 通过。一次经 npm 传递 `--check` 未传入子脚本，实际启动候选并在自动化环境再次报 GPU `0xC0000135`，没有成功窗口或模型请求；此环境不再重复启动。用户本机的新交互入口尚待验收。构建成功不改变这些限制。

## 历史阶段待办（已由上节更新）

1. 用户提供的本地源码已完整解压到 `artifacts/verification/opencode-bootstrap/local-source/opencode-3104c1428ec91f809e5ab86631300de41eb6952e`，源码获取阻碍已解除。使用 `scripts/extract-opencode-local.py` 将 60 个符号链接展开为副本，不需要 Windows 符号链接特权；6,630 个输出文件与归档内容的 SHA-256 校验通过。归档 SHA-256 为 `4b5f2e5edfc796082a353fd09c1b1dec3e7a108a4b080fe3a86b12d9fa59fae6`，gzip CRC 通过；该哈希是本地记录，不是独立的官方来源认证。链接映射与逐文件哈希见同级 `extraction-report.json`；后续修改链接目标时必须同步副本。保留 MIT 版权与许可证。当前仍没有 BotGo 版原生桌面成品。
2. 在原生桌面接入 BotGo 登录、OS 加密设备凭据、session 接口及仅 BotGo provider 配置；按模型协议选用正确 SDK。保留原生界面、配置和 Agent 循环，补充实际任务 ID 传递、累计费用及过期重连，禁止自动重放任务。
3. 完成 Windows 命令、中文路径、恢复、停止、权限、子代理、Skills、MCP、更新签名与干净安装矩阵；当前只验证了写文件、读文件及续接。
4. 运行并实际查看 Web 与后台 Chromium 验收，修复发现的问题。当前视觉改动未验收。
5. 完成 Workers 实际运行时验证和测试账户整链路。部署前备份 D1，再应用 0017；本轮未运行远程迁移、部署、上传或切换下载指针。

本地自动化检查入口：`npm test`、`npm run check`、`git diff --check`。UI 入口：`desktop/node_modules/electron/dist/electron.exe tests/opencode-ui.cjs`；需要能运行 Chromium 子进程的环境。
