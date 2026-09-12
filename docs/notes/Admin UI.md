---
type: implementation-map
updated: 2026-09-12
tags: [botgo, admin, ui]
---
# Admin 界面

上级：[[../PROJECT_MAP]] · [[Models and Metering]] · [[Release 2026-09-12]]

- admin.html 定义导航与视图；admin.js 管理授权、导航和移动端关闭交互。
- admin-layout.css 保留 BotGo 蓝色主题，集中覆盖布局、表格、模型卡片与响应式样式。
- admin-metering.js 管理模型目录、计费设置和用量记录三个标签页，模型通过侧栏编辑，支持删除保护、加载重试和失败时保留输入。
- admin-platform.js 处理运行管理页面，加载错误必须可见。
- tests/admin-ui-preview.cjs 使用隔离 API 夹具验证明暗主题、三种宽度、导航、保存失败、加载重试和无权限状态；不能替代生产管理员操作验收。

本轮已移除邀请码、Pro 操作及前端审计日志；用户赠送余额和开放注册见 [[Open Registration and Retention]]。所有 Admin 资源均由构建脚本添加内容版本号。

## 仅发布 Admin（用于后续纯后台变更）

scripts/prepare-admin-release.mjs 接收生产基线目录与新的输出目录，只替换六个 Admin 文件，并校验其余文件哈希。目录必须位于项目内且以 .tmp- 开头，输出目录不可已存在。

不要直接发布完整 dist：构建版本变化会影响首页及 CSP。固定快照核验通过后才能发布 Pages；本流程不部署 Worker、不迁移数据库、不发布 Desktop。
