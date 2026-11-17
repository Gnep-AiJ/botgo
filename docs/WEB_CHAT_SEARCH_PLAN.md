# 原生 Web Search 接入建议

选定方案：使用当前 kedaya 的 **Responses 内置 `web_search`**，搜索与回答在同一条请求中完成，复用现有 Admin 路由、BotGo 账本和对话保存。`/v1/alpha/search` 已实测，但不再作为网页首选；它需要独立搜索请求和后续回答，增加计费与失败处理的复杂度。不新增搜索供应商、API Key 服务或依赖。

## 已确认与未确认

2026-10-08 使用用户明确提供的限额测试 Key 实测：

- `alpha/search` + `gpt-5.6-luna`：200，返回官方来源。
- Responses + `gpt-5.6-luna`：200，`tool_usage.web_search.num_requests=1`。
- 流式 Responses + `gpt-6.1-sol`：200，真实搜索事件、来源 annotations、完整 usage。
- 同一 GPT-6.1 Sol 经 BotGo 实际路由、计费、历史保存适配器：200，账本结算与来源保存成功。测试账户/账本使用隔离内存 SQLite，未写正式账户数据。
- `max_tool_calls` 被 kedaya 以 400 拒绝，因此适配器不发送该参数；不能把官方完整参数表直接当作此上游支持表。

证据：`artifacts/verification/web-chat/native-search/{probe,stream-probe,gateway-probe,final-usage}.json`。没有将测试 Key 写入文件或更换正式上游密钥。生产原有 Key 的搜索权限仍需正式登录后的请求验收，不能用另一把测试 Key 的结果替代。

用户最新授权为“先不管附加费，先启用/测试”，取代此前的零附加费门槛。仍仅使用当前上游原生搜索。

上游最终用量记录 4 次成功请求，`actual_cost=0.00727511 USD`。单独 GPT-6.1 Sol 流式测试增量 `0.00277256 USD`，经 BotGo 适配器测试增量 `0.00299214 USD`，当前分组倍率 0.14。Luna 的两次请求合计标准 cost `0.01078862 USD`，其中相对当时 token 费率估算多出 0.01 USD；这是聚合账单推算，不能精确归因到其中某个接口或证明其他请求免费。quota 字段更新曾滞后，以请求用量记录为观测依据，不宣称零附加费。

## 最小启用路径

1. 按最新要求改为模型按需联网，界面只显示“按需联网”，不再要求用户切换；旧浏览器联网偏好不再参与判断。首次进入仍优先 GPT-6.1 Sol，保留用户模型选择，不改 Admin 全局默认。只在已验证 kedaya `/v1` Responses 的 `gpt-6.1-sol` / `gpt-5.6-luna` 开放，没有新增 Luna 路由。
2. 服务端根据真实候选路由自动提供 `tools:[{type:'web_search',search_context_size:'low'}]`、`tool_choice:'auto'` 和 sources include。不支持搜索的模型正常对话，不偷换模型。客户端自定义托管工具仍被拒绝，Desktop 工具限制保留。
3. 原有账户并发、180 秒超时、上下文/输出限制、取消、幂等、结算/退款继续生效。上游不支持硬性 `max_tool_calls`，low 只控制搜索上下文规模，不能声称每轮最多搜索一次。
4. 检索事件出现时才显示“正在检索”。完整回答不需要发生搜索才能成功；搜索次数为 0 正常结算，不再误判为失败。真正失败、取消、缺失用量及不完整响应才退款。
5. 返回的 URL citations 转为最多 12 条 Markdown 来源并随回答保存；前端/历史使用一致格式，只链接合法 HTTP(S)，拒绝携带用户密码的链接，文本通过 DOM 安全渲染。网页资料不能覆盖百科/医生/塔罗牌规则。历史仍按每条消息创建时间保留 30 天。
6. BotGo 仍按原有 token 价格结算，不改倍率，不显示实时费用。usage_json 记录上游搜索次数；snapshot 标识 `toolFee:'not_in_token_estimate'`。当前上游成本估算仅含 token，没有把未确认工具附加费伪装为 token 成本或向用户另收按次费用。
   计费链路：浏览器 `/api/chat/stream` → BotGo Worker 的 `meteredProxy` → Admin 已验证路由对应正式上游 Key → kedaya Responses；完成后按模型 token 价格、倍率、汇率结算到 BotGo 用户余额，账本渠道为 `web_chat`。联网资料 token 同样计入 usage。当前没有用户按次搜索收费项，上游工具附加费不包含在 token-only 成本估算内。
7. 离线与真实上游证据分开：真实请求已验证提供的测试 Key；正式账户、原配置 Key 的完整链路仍需登录实测。保留原配置密钥、账本及回滚版本。

2026-10-08 按需协议实测：同一测试 Key、GPT-6.1 Sol、`tool_choice:'auto'`，中文问候 HTTP 200 且搜索次数 0；请求官方 Cloudflare 文档 HTTP 200 且搜索次数 1。证据 `artifacts/verification/web-chat/images/probe.json`，不代表生产原 Key 权限验收。

测试：`npm test` 包含搜索路由、SSE/JSON 来源保存、回放防重复扣费、零搜索完整回答成功及上游失败退款；Chrome 验证指示文字、链接安全、历史恢复、双主题与移动布局。

来源：

- [Codex alpha/search 客户端](https://github.com/openai/codex/blob/main/codex-rs/codex-api/src/endpoint/search.rs)
- [Sub2API 搜索转发与计费记录](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/service/openai_alpha_search.go)
- [Sub2API 分组工具价格配置](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/service/group.go)
- [LibreChat Web Search](https://www.librechat.ai/docs/features/web_search)
- [OpenAI Responses Web Search 与来源引用](https://developers.openai.com/api/docs/guides/tools-web-search)
