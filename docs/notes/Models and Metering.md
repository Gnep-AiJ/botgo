---
type: module
updated: 2026-09-12
status: production
tags: [botgo, models, billing, agent]
---
# 模型与实际用量计费

最新变更：迁移 0015 已移除 GPT-5.4 当前目录；种子不再创建它，历史账单价格快照和旧探测证据保留。以下价格说明包含历史版本依据，不表示该模型仍可选择。

上级：[[../PROJECT_MAP]] · 相关：[[Account and Billing]] · [[Desktop and CLI]] · [[Release 2026-09-12]]

## 入口与契约

- `GET /models` 返回公共目录，不包含上游地址或凭据；网页、Desktop、CLI 共用。旧 `gpt-5.6` 请求映射到后台默认模型，未知/禁用模型拒绝。
- `worker/src/metering.js` 处理目录、价格、SSE 用量和后台；`0014_metered_models.sql` 提供预留/结算触发器。
- 后台计费页增加 `admin-metering.js`。初始化目录后，需配置当前渠道路由并重新探测对应模型，再启用渠道。旧的 HTTP 状态探测不满足新的 metering_verified 条件。
- 默认全局倍率 0.3、USD/CNY 7.00；模型倍率为空时继承。它们是管理员配置，不是实时汇率。
- 价格是 2026-09-12 Standard 快照；来源：[官方价格](https://developers.openai.com/api/docs/pricing)、[GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5)、[GPT-5.4](https://developers.openai.com/api/docs/models/gpt-5.4)。5.4/5.5 缓存写入按普通输入处理，不套用 5.6 的写入溢价。

## 账务不变量

1. 分字段继续服务充值；微元余数保存小额消费，不按每次一分取整。BigInt 计算后仅向上取整到一微元。
2. 输入、缓存读取、缓存写入、输出分别计价；reasoning 已包含在 output 内，不重复计费。超过 272000 输入 token 使用快照内长上下文倍率。
3. 预留与余额检查由同一 SQLite 触发器原子执行；结算使用状态条件确保同一请求只扣一次。调用方可提供 16–128 字符 `Idempotency-Key`，重复请求返回 409，不重新调用上游。
4. 只接受终态 Responses usage 或 Chat Completions usage。缺失/非法 usage 转 review、不假定消费，禁用对应模型。已预留金额释放。
5. 取消下游同时取消上游读取。进程中断遗留的预留超过 10 分钟后，在该账户下次请求时转 review 并释放；模型保持禁用等待核对。
6. 超出预留时最多扣除未被其他请求预留的余额，绝不透支；账本保留应付与实扣差额并限制账户。后台填写核对说明后解除该记录限制；不自动补扣。
7. 每次请求保存价格、倍率、汇率、模型与配置版本快照。后台改价仅影响后续请求，并写审计。

## 当前功能边界

- `codex-auto-review` 是旧身份模式产生的内部 ID，Worker 明确拒绝且不向上游转发。API-key 身份模式下，Codex `0.154.0` 的真实审核请求使用 `gpt-5.6-luna`；它按 Luna 的实际价格、倍率和 usage 独立结算。账本快照保存 `requestedModel`、`billingModel=gpt-5.6-luna`、任务 Key 的 `selectedModel` 与 `requestPurpose=auto_review`。
- 自动审核能力要求有效 Desktop 设备、生产开关、可用的 `desktop_codex` 路由，以及同一 profile 下 24 小时内真实 Luna Responses/流式 usage 探测。只有绑定其他任务模型的 Desktop v2 Key 才能在该能力开启时跨模型请求 Luna；其他不匹配仍拒绝。旧的无模型 Key 只兼容普通请求。
- 仅 Standard，暂不开放 Fast/Batch/Flex、后台请求、previous_response_id 或收费托管工具。Agent 发送完整续接上下文，可使用本地 function/custom/shell/apply_patch 工具。
- 单次输出最多 16384 token；预留输入按 UTF-8 大小加隐藏提示裕量估算，实际结算以 usage 为准。图片/文件等扩展输入的完整计量尚未验证。
- 所有模型初始禁用。2026-09-12 真实上游小请求：Sol/Terra/Luna/5.5 均通过 Chat 流式 usage、Responses 工具调用与完整上下文续接。5.4 返回 429，Astra 返回 404，暂不启用。
- 这份探测记录不是生产配置。管理员启用前必须对实际绑定的 profile/channel/model 再探测。

## 验证与发布

`npm test` 的 pretest 用 Node 22 SQLite 执行全部迁移，验证小额/缓存/推理/长上下文、原子预留、幂等、超额和 SSE 中止。真实上游脚本 `scripts/probe-models.mjs` 仅从进程环境读取测试凭据，输出无秘密的能力状态。

2026-09-12 已顺序迁移生产 0013、0014 并发布兼容 Worker。五个模型（含 GPT-6 Astra）通过当前生产上游探测并启用，5.4 返回 404 保持禁用；详见 [[Release 2026-09-12]]。新环境仍须先迁移再部署。生产已有账务单位不能通过代码回滚恢复为元。

2026-09-14 生产 profile 的 Luna 工具、续接、终态 usage 和原生允许路径再次通过，Sol/Luna 双账本实测成立。危险请求由主模型在工具前拒绝且目标未发生，符合最终口径。由于生产撤销/失效 Key/余额不足故障矩阵仍缺少独立测试账户和设备，已按门禁恢复关闭；当前兼容 Worker 为 `744c67a7-9944-471b-916d-b43a0fa2f7ff`，未运行新迁移。
