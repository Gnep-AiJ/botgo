# Web 对话生图与停止

沿用原有 Admin `default_image_model`、已验证 `image_model_routes` 和 BotGo 账本，默认图像模型当前为 `gpt-image-2.5-sunburst`。聊天模型与图像模型分开；不按 GPT-6.1 Sol 的文本价格结算图片，不改倍率，不在对话中实时显示费用。UI 与后端参考 Open WebUI 的原生 generate_image 工具注入及 LibreChat 的持久图片历史，未引入其框架或新搜索服务。

生图默认作为服务端工具与 web_search 一同提供，tool_choice=auto；聊天模型按对话判断是否生成，并选择方图或横竖 3:2。输入区没有独立生图开关、模型、画幅或质量选项。默认 medium 质量，每轮最多一张；图片工具直接完成用户回答，不额外追加模型总结请求。服务端只生成一张 PNG，提示词最多 8192 字符；拒绝客户端覆盖模型与工具。沿用 180 秒超时、账户/上游并发与完整图像用量校验。图片失败、无有效用量、超过预留、PNG 无效、存储失败或停止均释放未完成图片的 BotGo 预留款和并发租约；已完成的聊天模型判断按实际文本用量结算，图片失败不撤销这部分已完成费用。不会自动重发状态不明的生图。重试先核对历史，已完成仅恢复，未完成由用户明确重试。BotGo 退款不代表上游退费。

图片在现有 R2 binding 的独立 `web-chat/media-v1/` 前缀保存，使用 HKDF 派生独立媒体密钥与 AES-GCM 加密，并绑定账户/文件 ID 为 AAD。R2 不存明文图片；原桌面安装包路径和发布记录不变。`/api/chat/images/:id` 每次验证登录、归属、完成状态和 30 天时效，响应 no-store，支持下载。对话只存图片引用与模型生成的描述，不把 base64 塞进聊天历史或计费日志。后续对话可读取文字描述，参考图编辑仍未接入。

图片索引、账本结算和回答完成状态在 D1 原子批次提交，先持久化文件再结算。写文件前登记清理项，覆盖孤儿文件及失败请求。删除/过期通过级联触发器排队，原定时维护每次最多清理 100 个超 10 分钟、无引用的媒体对象，只处理媒体前缀。

停止使用独立 `/api/chat/cancel`：账户/对话归属校验、持久取消意图、原子退款和租约释放。停止可以早于模型响应、发生在流式输出/图片生成中，或用于刷新后仍运行的回答。文本判断使用按父请求派生的稳定账本 ID 和 webTurnId，图片保留父账本 ID；取消原子释放当前父请求下全部未完成预占，已完成账本不可被退款或重复执行。上游工作每秒检查取消意图并中断，避免依赖浏览器 → Pages → Worker 的断连传播。完成后再停止不退款、不覆写结果。停止失败保留可再次停止的界面，不声称后端已停止。

迁移：`0031_web_chat_cancellation.sql`、`0032_web_chat_images.sql`，均为追加结构，不改历史账本、路由或账户余额。回滚旧 Worker 可保留新增结构与媒体，但回滚期间不执行新媒体清理。

2026-10-09 自动生图验收：限额 Test Key 通过真实 BotGo 处理器 + Kedaya GPT-6.1 Sol，web_search 与 generate_image 同时注入。问候只返回文字；绘图请求返回原生函数调用，随后 gpt-image-2.5-sunburst /images/generations 返回 HTTP 200，medium PNG 已通过私有保存和读回。证据在 artifacts/verification/web-chat/auto-images/probe.json；账本/R2 为本地隔离环境，不等同正式登录账号付费验收。

此前证据分层：限额测试 Key 真实生图返回 HTTP 200、PNG 682100 字节、input_tokens 17 / output_tokens 272；原价格快照与配置读回 `artifacts/verification/web-chat/images/image-routes.json`。SQLite/R2 fixtures 验证真实处理器的计费、加密、归属、保存、下载、取消、失败和清理；Chrome 通过真实 HTTP 流验证交互。正式账号/正式上游 Key 尚需登录后的付费请求验收，未将测试 Key 安装到生产。

本次实现文字对话与文生图。图片上传识别、参考图编辑、语音、视频和 ChatGPT 私有工具未接入，不能宣称完整复制 ChatGPT。

参考：[Open WebUI image usage](https://docs.openwebui.com/features/chat-conversations/image-generation-and-editing/usage/)、[LibreChat image generation](https://www.librechat.ai/docs/features/image_gen)、[OpenAI image generation](https://developers.openai.com/api/docs/guides/tools-image-generation)。
