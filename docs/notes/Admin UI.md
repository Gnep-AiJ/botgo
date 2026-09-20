---
type: implementation-map
updated: 2026-09-12
tags: [botgo, admin, ui]
---
# Admin 界面

上级：[[../PROJECT_MAP]] · [[Models and Metering]] · [[Release 2026-09-12]]

- admin.html 定义模型服务、上游连接、调用与账务、用户与设备、版本发布五个导航入口。
- admin-layout.css 用浅灰页面、白色表格和蓝色主按钮；模型表格通过侧栏编辑。
- admin-metering.js 只将模型保存到 `model_service_drafts`。测试使用草稿和现有加密上游配置；发布前核对测试指纹并原子切换客户端模型。调用记录放在“调用与账务”。
- admin-platform.js 管理上游、订单和版本。上游删除前显示关联模型；有绑定可停用并解除，有历史则退役归档。
- worker/src/model-services-admin.js 是草稿、测试、发布入口；迁移 `0021_retired_upstreams.sql` 保存草稿并为上游添加退役时间。
- tests/admin-ui-preview.cjs 使用隔离 API 夹具验证明暗主题、三种宽度、导航、保存失败、加载重试和无权限状态；不能替代生产管理员操作验收。

本轮已移除邀请码、Pro 操作及前端审计日志；用户赠送余额和开放注册见 [[Open Registration and Retention]]。所有 Admin 资源均由构建脚本添加内容版本号。

## 仅发布 Admin（用于后续纯后台变更）

scripts/prepare-admin-release.mjs 接收生产基线目录与新的输出目录，只替换六个 Admin 文件，并校验其余文件哈希。目录必须位于项目内且以 .tmp- 开头，输出目录不可已存在。

不要直接发布完整 dist：构建版本变化会影响首页及 CSP。固定快照核验通过后才能发布 Pages；本流程不部署 Worker、不迁移数据库、不发布 Desktop。
