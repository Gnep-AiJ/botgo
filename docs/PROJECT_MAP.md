---
type: map-of-content
project: BotGo
status: active
tags: [botgo, architecture, ai-handoff, frontend, cloudflare]
updated: 2026-09-11
---

# BotGo 项目地图

这份文档面向 AI Agent 和接手开发者：先用任务类型定位入口，再只读取相关文件。`dist/` 是构建产物，不直接编辑。

当前生产历史快照见 [[notes/Production Release 2026-09-10]]；本轮 GitHub/Cloudflare 发布证据见
[[notes/Agent Handoff 2026-09-11]]。

本次接管与版本控制状态见 [[notes/Agent Handoff 2026-09-11]]。

## 1. 先判断你要改哪一层

| 任务 | 先读 | 主要修改 | 验收 |
| --- | --- | --- | --- |
| 首页视觉、动画、响应式 | `index.html` | `styles.css`、`app.js` | `tests/home-hero-split.test.mjs`、`tests/cinematic-layout.test.mjs` |
| AI 工作台颜色、布局、交互 | `workspace.html` | `workspace.css`、`workspace.js` | `tests/homepage-workspace.test.mjs`、实际桌面/手机截图 |
| 登录、订阅、对话 API | `workspace.js`、`functions/api/[[path]].js` | `worker/src/index.js`、`worker/src/desktop-auth.js`、迁移文件 | `tests/desktop-web-auth.test.cjs`、部署后接口检查 |
| 管理端 | `admin.html` | `admin.css`、`admin.js` | `tests/admin.test.mjs` |
| Windows 桌面端 | `desktop/README.md` | `desktop/main.cjs`、`desktop/renderer.js`、`desktop/lib/` | `npm run test:desktop` |
| 构建与本地预览 | `package.json` | `scripts/build.mjs`、`scripts/dev.mjs` | `npm run check`、`tests/dev-preview.test.mjs` |
| 发布配置 | `DEPLOYMENT.md` | `wrangler.toml`、`worker/wrangler.jsonc`、`_headers` | `npm run check`；发布需人工确认凭据与环境 |

## 2. 运行时链路

```text
浏览器
  ├─ index.html + styles.css + app.js
  ├─ workspace.html + workspace.css + workspace.js
  └─ admin.html + admin.css + admin.js
        │ /api/*
        ▼
Pages Function: functions/api/[[path]].js
        │ BOTGO_API Service Binding
        ▼
Cloudflare Worker: worker/src/index.js
        ├─ D1: worker/migrations/*.sql
        ├─ R2: 私有桌面安装包
        ├─ 邮箱：QQ SMTP Worker Secrets
        └─ 上游模型：D1 加密配置；环境变量仅作迁移回退
```

本地 `npm run dev` 只提供静态页面和热刷新，不模拟 Worker API；本地未部署时 `/api/*` 返回 404 是预期限制，不要为此在前端添加假 API。

## 3. 网站入口与文件边界

- `index.html`：官网首页；生产构建会把 `styles.css` 和 `app.js` 内联进 `dist/index.html`。
- `workspace.html`：BotGo AI、桌面端和指南三个视图；由 `?view=chat|agents|tutorials` 选择。
- `workspace.css`：工作台唯一样式源。主题 token、头部网格、聊天输入区和弹窗都在这里维护。
- `workspace.js`：视图切换、主题、认证、订阅和流式对话；不要把凭据或底层 CLI 命令放回网页。
- `admin.*`：后台页面，负责邀请码、账户、上游、Pro 套餐和桌面发布，和公开工作台分开验收。
- `desktop/`：Electron 应用，不属于网页预览服务。
- `assets/`：被构建脚本白名单复制的生产图片；不要把临时截图放入这里。
- `dist/`：由 `scripts/build.mjs` 清空并重新生成；任何手工文件都会在下一次构建丢失。

## 4. 工作台 UI 不变量

详见 [[notes/UI Workspace]]。修改 `workspace.css` 时至少保持：

1. 桌面端保留左侧会话栏，主内容不产生横向滚动。
2. `760px` 以下隐藏侧栏；头部为品牌/账户第一行、导航第二行。
3. `520px` 以下账户操作按内容宽度布局，登录、注册和主题按钮不能被挤出视口。
4. `380px` 以下只收紧按钮内边距，不隐藏未登录入口。
5. 浅色与深色主题使用同一语义 token；深色弹窗必须是不透明高对比表面。
6. 聊天输入区使用动态视口和安全区，不能贴住手机底部或被裁切。

## 5. 本地开发唯一入口

```bash
npm run dev
```

默认监听 `127.0.0.1:4173`。需要局域网预览时：

```powershell
$env:BOTGO_DEV_HOST = "0.0.0.0"
npm run dev
```

项目不再提供第二套 Python `preview` 服务；不要让其他进程占用 `4173`。开发服务已经忽略 `desktop/`、`worker/`、`docs/`、`tests/`、`dist/` 及临时截图/浏览器目录，避免无关写入触发重建。

## 6. 变更与验收顺序

1. 从本页任务表进入最小相关文件集合。
2. 修改源文件，不修改 `dist/`。
3. UI 变更先运行 `npm run build`，再用实际浏览器检查桌面、手机、浅色、深色和弹窗状态。
4. 运行 `npm test`；涉及语法或构建时再运行 `npm run check`。
5. 运行 `git diff --check`，检查 `git status --short`，确认没有临时截图、浏览器 profile 或意外生成物。

## 7. 稳定架构与安全决策

- 新用户以邮箱、一次性邀请码和六位验证码注册；已有用户仅以邮箱验证码登录。管理员由账户会话、角色或 `ADMIN_EMAIL` 共同鉴权，不能暂停自己或提升他人角色。
- QQ 邮件固定通过 `smtp.qq.com:465` TLS 发送，凭据只存在 Worker Secrets；邮件失败返回通用错误，不泄露服务端响应。
- 上游 API Key 由 `UPSTREAM_CONFIG_KEY` 使用 AES-GCM 加密后存入 D1。新配置必须测试成功才能手动启用，不自动故障转移，也不向网页或桌面端返回上游信息。
- Pro 套餐按 30 天管理，续期延长当前有效期并重置本期额度。支付宝审核期间购买保持禁用；支付权益只能由验签成功的异步通知或主动查询产生。
- 桌面端只连接 BotGo API，设备凭据使用系统安全存储。安装包存于私有 R2，通过登录态和短时签名链接下载。
- Electron NSIS 使用品牌位图、文件白名单和最大压缩；未签名版本只允许受控内测，公开发行必须完成代码签名和干净机器验证。

## 8. 当前已知限制

- 未部署 Worker 时，网页本地预览不能完成真实登录、订阅或模型流式请求；需要部署环境和凭据才能人工验收。
- `desktop/dist/` 中的安装包是桌面端产物，不应被网页构建脚本复制或作为网页入口。
- `CLAUDE.md`、`.codex/`、`.agents/` 和 `.claude/` 属于当前协作配置；除非任务明确要求，不要删除或移动。

## 9. Agent 记录与版本控制边界

- 可审计的接管、验证和决策记录放在 `docs/notes/Agent Handoff 2026-09-11.md`；后续 Agent 继续追加同类记录，不把聊天全文伪装成仓库历史。
- 应提交源码、测试、迁移、发布文档和 `docs/` 记录；不提交 `.secrets/`、`.wrangler/`、`dist/`、`node_modules/`、本地技能目录或 `.tmp-*` 临时日志。
- GitHub remote 为 `origin`；推送前必须确认 GitHub CLI 或 Git Credential Manager 已重新授权，并在本地检查 `git status --short`。
