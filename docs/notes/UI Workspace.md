---
type: atomic-note
topic: workspace-ui
tags: [botgo, ui, responsive, theme]
---

# UI Workspace

## 入口

- 结构：`workspace.html`
- 样式：`workspace.css`
- 交互：`workspace.js`
- 共享菜单/Markdown：`ui-kit.js/css`（Desktop 构建同步复制）
- 应用安装与指南：`agent-install.js`，导航为“对话 / 应用 / 指南”
- 契约测试：`tests/homepage-workspace.test.mjs`

## 版式骨架

```text
workspace-stage（城市背景 + 遮罩）
└─ workspace-shell
   ├─ workspace-header（品牌 / 导航 / 账户）
   ├─ conversation-sidebar（桌面端）
   └─ workspace-main
      ├─ chat（消息 + composer）
      ├─ agents（桌面端入口）
      └─ tutorials（指南）
```

## 断点规则

- `>760px`：两列工作台，左侧会话栏固定在第二行。
- `≤760px`：隐藏会话栏；头部改为两行，导航独占第二行。
- `≤520px`：账户操作使用 `max-content`，导航允许横向滚动；输入框为 `calc(100% - 24px)`。
- `≤380px`：仅收紧文字按钮和模型选择器的内边距，保持所有入口可见。

## 颜色规则

语义变量集中在 `workspace.css` 的主题 token 区域：`--workspace-canvas`、`--workspace-surface`、`--workspace-elevated`、`--copy-strong`、`--copy-muted`、`--edge-soft`。新增组件优先复用 token，不要在单个组件中重新发明一套蓝灰色。

主题由 `workspace.js` 的 `applyTheme()` 设置 `data-theme` 和 `color-scheme`，用户选择保存在 `localStorage['botgo-theme']`。按钮使用太阳/月亮 SVG，不要用文本覆盖图标。

## 修改检查

- 是否产生横向滚动？
- 头部在 390px 和 360px 是否同时看得到品牌、主题、登录、注册和导航？
- 弹窗在深色主题是否有不透明背景、边界和可读标签？
- 输入区是否避开 `env(safe-area-inset-bottom)`？
- 是否保留键盘焦点轮廓和至少约 40–44px 的触控区域？

## 2026-09-12 更新

账户面板采用单层紧凑布局，保留邮箱、余额和充值；安装页新增 CLI 一键安装教程。旧版关于网页不展示任何 CLI 命令的限制不适用于用户明确要求的安装教程。真实执行仍只在本地客户端。当前证据见 [[Release 2026-09-12]]。
