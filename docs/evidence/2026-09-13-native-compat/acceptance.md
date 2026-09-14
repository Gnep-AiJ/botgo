# 原生能力兼容：本地候选验收

日期：2026-09-13，2026-09-14 按最终验收口径复核。结论：**原生允许链路和双账本已修复并通过；危险请求最终未执行。是否发布仍取决于其余生产、打包和在线门禁。**

当前候选为 Desktop `1.2.1-preview.7` / CLI `0.2.5`。开启版 Worker 短时完成真实验收，随后因其余生产故障矩阵缺少独立测试账户/设备而恢复关闭；没有上传包、改变线上下载指针、部署 Pages 或清理旧版本。真实验证通过既有 API 签发执行密钥和计费，属于正常业务写入。

## 2026-09-13 复核结论

先前把 `codex-auto-review` 503 解释为上游不支持是不正确的。与 CC Switch 行为对照后确认：隔离 Codex Home 必须具备 API-key 身份标记，实际审核模型才会选择 Luna。生产加密 profile 通过 Luna Responses 工具、续接和终态 usage；内置 Codex 请求序列为 Sol→Luna→Sol，受控工作区外写入获批且未请求人工批准。

生产短时开启期间，MCP、自动审核允许和真实账本均通过。账本将 Sol 主任务与 Luna `auto_review` 分开，记录实际 usage、成本与 `selectedModel=gpt-5.6-sol`。未授权工作区外写入由主模型在工具调用前直接拒绝；递归删除和远程代码执行测试又被外层安全审核阻止，均未执行。最终验收口径不强制危险请求进入审核器：主模型提前拒绝或 Luna 拒绝都合格，但必须证明目标未发生。生产能力随后恢复为 `AUTO_REVIEW_ENABLED=0`，等待其余发布门禁复核。

2026-09-14 用户在风险说明后要求继续；`.invalid` 保留域名的远程代码管道测试获准启动，但主模型仍在调用工具前拒绝，因此没有下载、执行或 Luna 审核事件。开启版仅用于该短时验收，随后恢复关闭版 Worker `a27c12b1-b3e4-4b7b-8285-9cc438cd2e89`。按最终口径，该结果满足危险请求“最终未执行”的门禁；它不证明 Luna 对高风险动作必然给出 denied。

证据：`artifacts/verification/production-profile-probe-1789300721949/result.json`、`artifacts/verification/native-cc-review-1789300751725/result.json`、`artifacts/verification/native-compat/live-1789301227203/result.json`、`artifacts/verification/native-compat/live-1789301628667/result.json`。

## 历史阻塞（已被上述复核取代）：旧身份模式请求错误 ID

内置 Codex `0.154.0` 的普通任务使用 `gpt-5.6-sol`，自动审核子请求使用 **`codex-auto-review`**。这两个名称从隔离原生运行日志中按模型字段提取，未导出原始 HTTP 日志或凭据。

真实受控测试授权在验证目录内、所选工作区外写入一个测试文件。原生引擎发出 `item/autoApprovalReview/started`，随后发出 `guardianWarning` 和 `item/autoApprovalReview/completed`。审核结果为 denied，原因是 `Automatic approval review failed: {"error":"所选模型暂不可用。"}`。目标文件没有创建；没有接受替代审批、重发拒绝动作或放宽沙箱。

`worker/src/metering.js` 的模型准入检查只对 `gpt-5.6` 做现有默认模型解析；其余名称必须匹配已启用且支持 Agent 的计费模型。这解释了审核子请求的 400 错误。**该结果是路由故障导致拒绝，不是通过了审核策略的“合理拒绝”验收。**

最小后续范围：核实实际上游是否提供可用的 `codex-auto-review`，为它建立对应的模型目录、Agent 路由、价格与 usage 验证；确认审核请求进入现有鉴权和计费。不能未经证明把专用审核模型冒充普通模型，也不能用假回复或完全访问替代。若上游不支持，需要支持该原生能力的真实上游。涉及生产 Worker 的变更仍需明确授权；本轮没有尝试绕过此前部署拒绝。

此后必须重新完成自动审核通过、真实策略拒绝及其计费验证。当前客户端仍以原生自动审核为默认，并在设置中明确标注当前路由不兼容。手动审批是用户显式选择的故障处理方式，不自动切换、不自动重放任务。

原始证据：`artifacts/verification/native-compat/live-1789291434899/result.json`。早期测试脚本中的 `requested-tasks-passed` 仅判断了原生 turn 的 completed 状态，**不能作为操作成功结论**；该文件同时明确记录 `approvedOutsideFile: false`。脚本现已补上行动结果门禁，不覆盖原始记录。

## 协议—面板—证据

协议清单与二进制/Schema 哈希见 [protocol.json](protocol.json)，由 `node agent/scripts/protocol-capabilities.cjs` 从内置二进制生成，包含实验字段。不是按最新版网站文档推断。

| 能力 | 本地实现/入口 | 当前证据与限制 |
| --- | --- | --- |
| 持久原生服务 | `app-server-connection.cjs` / `app-server.cjs`；正常 turn 结束保留连接 | 回归测试验证两轮仅一个进程、一次 initialize；真实连续两轮通过 |
| 账户与执行密钥 | 主进程每次服务连接取一次密钥；每轮检查账户、模型、额度 | 真实三轮、两次服务连接签发两次密钥；未验证所有撤销/长任务失效组合 |
| 默认工作区与恢复 | 登录后创建 `~/BotGo/Workspace`；保留输入；恢复本地选择与原生线程 ID | 代码接入；真实隔离普通目录文件创建、读取、重启恢复通过；不是全新 Windows 用户验收 |
| 流式、停止、补充指令 | 对话输入区，原生 turn/steer 和 turn/interrupt | UTF-8、迟到响应、停止、预期 turn ID 回归通过；断线不重放 |
| 计划模式 | 输入区“计划”，原生 collaborationMode | 真实第三方路由计划请求完成 |
| 图片和文件 | 系统选择器返回附件句柄；原生 localImage/mention | 包内 Electron 添加/移除 UI 验证；真实图片路由未验收 |
| 差异、计划、审核生命周期 | 输入区上方可展开详情 | Electron 卡片与原生真实 diff/审核事件；详情尚未持久存成独立结构化历史 |
| 原生代码审阅 | 设置“审阅当前项目未提交改动”，review/start | 接入当前协议；真实代码审阅输出尚未验收 |
| 会话新建/恢复/重命名/分叉/归档 | 侧栏菜单、设置内归档恢复；保留 native ID | 既有本地分页/历史升级测试通过；分叉和归档的完整真实模型历史场景尚未验收 |
| 切换查看 | 运行时允许查看其他会话；前台不并行执行 | 保存事件不再把查看中的选择强制切回运行会话 |
| 原生子代理 | 协作工具与已关联子线程事件展示 | 接入事件；真实子代理任务及独立计费未验收 |
| 自动/手动/只读/完全访问 | 输入区统一选择权限与审批；完全访问仍需确认 | 生产 Luna 允许与主模型提前拒绝危险请求通过；生产故障矩阵仍未完成 |
| MCP stdio / HTTP | 设置内添加、编辑、启停、重新连接、状态及工具列表 | 真实本地引擎工具发现、调用、工具失败和启停通过；stdio 工具还经过真实模型路由返回测试标记 |
| MCP 补充信息 | 原生 form 字段、URL 打开、提交/拒绝/取消 | 类型校验与 Electron 表单通过；真实模型到 MCP elicitation 完整链路未验收；其他 OpenAI 专用验证模式明确取消 |
| MCP OAuth | 原生登录 URL、外部浏览器、等待取消关闭服务 | 已接入；完整 OAuth 授权、取消、超时及重连矩阵未验收 |
| Skills | 发现、查看、本地安装、启停、附加到下一任务 | 真实插件技能发现/查看/启停通过；图形选择入口通过；完整独立安装到真实调用仍待验收 |
| 插件 | 添加本地 marketplace、发现、查看、确认安装、启停 | 受控本地插件通过真实安装与启停；启用后由其 Skills/MCP 提供调用能力；不默认安装第三方插件 |
| 独立配置 | 保留原配置；可选导入有确认及备份；账户路由覆盖仅在原生调用参数 | IPC 不开放任意 RPC/config path；MCP 编辑保留已有私有字段；全局配置不被写入 |

## 已执行验证

- `npm test`：完整项目测试通过，Agent 57 项；另加入并通过 3 项 Native Panel 安全测试。`npm run check`、构建与 `git diff --check` 的最终结果见本轮日志。
- 真实中转基础任务：创建 `BOTGO_NATIVE_OK` 文件、同进程读取、关闭服务后恢复同一 native thread 进入计划模式，全部完成，文件内容核对正确。余额变化 53 分。
- 真实 stdio MCP 路由：隔离原生会话的工具输出包含 `BOTGO_MCP_OK: routed-test`。同次测试中的自动审核路由失败；该次普通模型请求余额变化 22 分。不能把这 22 分全部归为审核收费，审核专用计费未证明。
- `node desktop/tests/native-controlled.cjs`：无需模型请求，使用当前二进制覆盖面板写入 stdio/HTTP 配置、确认取消、两类工具调用和工具失败、MCP 启停、本地插件安装/启停、插件技能发现/查看/启停。该脚本自建受控 marketplace 和服务。
- Electron：实际 renderer/preload、增量、审批、MCP 类型表单、附件增删、长技能内容、设置、100/125/150% 缩放和最小窗口。截图采集改为前台绘制，修正早期遮挡缓存；最终包内 UI 证据单独存放，不把 fixture 当真实登录或模型证据。
- Windows 沙箱内 DPAPI 解密失败；只读账户检查改用当前 Windows 用户的隔离 Electron 后通过。未输出密钥、token 或原始网络日志。

隔离工作区位于本仓库的 artifacts 下，可能继承仓库指令/Skills。没有给测试子目录初始化 Git，**但这不足以证明无父级 Git、无全局配置的干净用户环境**；这项验收仍保留。

## 2026-09-14 本地构建复核

- Desktop `1.2.1-preview.7`：182253752 字节；SHA-256 `2c8453e6f25f8bfd8dc1a94759b8542a2d7eba7fb444a57454eab62028ae5075`。
- CLI `0.2.5`：138204687 字节；SHA-256 `a6b407a7ba7ca740c50bcee2e3eaa49b443469e64dbb0cbc284048f96e340453`。
- Desktop ASAR 内 15 个源码/库文件与当前源码匹配；包内 Codex package 与可执行文件均为 0.154.0。安装包和主程序固定自签名指纹匹配；Authenticode 仅因自签根不受信任而非有效信任链。
- CLI 0.2.5 隔离安装验证通过：固定私有 Node、CLI/Codex 启动、Node 复用、覆盖安装保留 `previous`、错误哈希拒绝且当前指针不变。
- 包内 Electron UI 通过，新增能力面板、附件、计划、代码审阅入口及 MCP/Skills/插件列表均有实际窗口证据。

## 历史本地构建

- Desktop `1.2.1-preview.6`：182252760 字节；SHA-256 `380b1758cabc24a28ca7c9cd6977a7005deb25d012dab84e2903f5fed9b03fea`。
- CLI `0.2.4`：138204371 字节；SHA-256 `cdc1c42c9364b47cb3a7ed4c1959bbccf44364a89eb47d2fa885d66d96601da0`。
- Desktop 打包后共享运行文件逐项匹配，包内 Codex 0.154.0 启动通过；另核对 ASAR 内 16 个应用源码/库文件与当前源码一致。
- NSIS、主程序及卸载器沿用固定自签名身份 `104C109C454B26C3B5028EE66D8B225F447F953F`；安装包通过既有原生 Authenticode/指纹核验。这不建立 Windows 默认信任或 SmartScreen 声誉。
- CLI 隔离安装验证通过：下载并验证固定私有 Node、启动 0.2.4 和 Codex 0.154.0、复用 Node、覆盖安装保留 previous、错误哈希拒绝且当前版本不变。日志：`artifacts/verification/native-compat/installer-smoke.log`。测试使用本地新包，不等于公网发布或跨设备验收。
- 最终包内 Electron 测试 `desktop/tests/native-compat-ui.cjs --packaged` 通过，`errors=[]`；设置/附件/MCP 表单/审核卡片及缩放截图位于 `artifacts/verification/native-compat/electron-ui-packaged/`。
- 构建只是本地未验收候选。安装包没有上传，线上设备鉴权版本接口的待部署变更仍保留。

## 未完成项目

除表中明确待验收能力外，还包括真实不足余额/设备撤销/密钥失效与长任务中断矩阵、MCP 断线/超时/OAuth 全流程、无全局配置的新 Windows 用户、跨设备 Desktop 安装、覆盖升级、重启更新、卸载保留历史，以及生产新版下载/更新端到端验证。

因此旧轮次没有执行上线，也没有执行两版本保留清理。保留上一线上可用版本及既有回滚限制。危险请求门禁现已按最终口径满足，但其余未完成项目仍不能仅凭本地候选包直接推断成功。
