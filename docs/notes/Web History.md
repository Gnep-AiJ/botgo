---
type: atomic-note
topic: web-conversations
updated: 2026-09-12
tags: [botgo, web, history]
---
# Web 云端会话

入口：`workspace.js` 历史列表及移动端弹窗；Worker `src/conversations.js`，迁移 `0015_web_conversations.sql`。不与 Desktop 本地项目会话合并。

- `/api/conversations`：GET 每页 50 条、offset 分页；POST 由首条消息创建标题。
- `/api/conversations/:id`：GET 完整消息及生成状态；DELETE 删除会话和关联消息。所有操作使用网页登录会话，并按账户验证归属；响应 no-store。
- `/api/chat/stream` 新请求携带 conversationId、requestId、content、model。服务端读取上下文；旧 messages 请求兼容保留，不自动导入旧浏览器内存。
- web_chat_turns 保存用户内容、回复、模型和 running/completed/stopped/failed 状态。数据库触发器保证同一会话同时仅一个生成；requestId 和既有计费幂等键防止重复受理。
- 流式回复在收到数据时至多每秒保存一次，最终保存后结束响应；没有终止事件不标记成功。失联任务 4 分钟后在读取/操作时恢复为 stopped；此前已保存内容可继续使用。进程突然退出时尚未保存的尾部不能保证恢复。
- 删除正在生成的会话返回 409；当前网页先停止，再删除。删除不触碰计费账本、账户余额及模型价格快照。
- 账户变化清除页面消息；历史加载失败显示重试。历史标题及正文均通过 textContent 或既有安全 Markdown 渲染。

验证：`tests/conversations.test.mjs`、`tests/metering.test.mjs`；`tests/history-ui-preview.cjs` 使用隔离账户/API 夹具验证真实浏览器点击、刷新、另一窗口读取和确认删除。夹具验证不等于生产账户登录验收。
