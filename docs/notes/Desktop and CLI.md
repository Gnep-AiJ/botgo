---
type: module
updated: 2026-09-12
tags: [botgo, desktop, cli]
---
# 桌面与 CLI

上级：[[../PROJECT_MAP]] · 相关：[[Account and Billing]] · [[Release 2026-09-12]]

## 产品与调用

桌面是极简对话界面，任务实际调用 Codex CLI。保留项目、会话、只读/工作区可写/完全访问、停止及恢复。低频文件改动折叠；通过原生终端入口使用其余兼容能力。

- 运行器：`agent/lib/codex-runner.cjs`；桌面通过 `desktop/lib/agent-runtime.cjs` 引用，打包时复制同一源码。
- 原生 Windows Codex 版本以 `agent/package-lock.json` 为准，本轮基线 0.154.0。桌面不自动使用用户全局 Codex。
- `task:start` 校验项目、提示与权限，主进程获取设备执行凭据；命令行不包含凭据。
- 共用配置参数固定 BotGo provider、Responses 与服务域名，模型由服务端目录与所选模型决定，默认 Sol；原生配置其余设置保留。
- 交互终端直接输入 `botgo`：未登录或凭据过期时打开网页登录，成功后进入原生 Codex。无 TTY 时只显示帮助。支持 `--model <id>`。
- 保留 `botgo auth login`、`botgo account`、`botgo run`、`botgo resume`、`botgo sessions`、`botgo codex -- <参数>`。图形与 CLI 会话保存所用模型。
- `ui-kit.js/css` 提供模型与权限菜单、键盘操作、上下翻转和安全 Markdown；桌面构建通过 sync-assets 复制同一实现。
- 终端会话与图形会话不做实时双向同步；已有 session ID 可在终端恢复。
- Windows 停止操作只结束当前 Codex 进程树；退出桌面会停止当前图形任务。

## 数据与迁移

2026-09-12 本地设计修复：侧栏为平铺最近对话，项目从顶部切换；同名项目显示路径。支持对话重命名、删除，以及从 BotGo 移除项目及其界面对话记录。删除需确认，不删除磁盘项目目录或原生 Codex 会话文件。执行期间禁止管理操作。

`local-state.cjs` 用临时文件原子替换历史；读取异常保留原文件并报错。单实例运行，启动时把遗留运行中记录恢复为停止。账户面板限制在侧栏内，模型和权限菜单支持键盘及边界翻转。

CLI 登录提供等待倒计时、Enter 重开浏览器、手动链接和 Ctrl+C 取消；API 请求设 20 秒上限，远端取消失败不阻塞本地清理。重复回调拒绝交换，取消后迟到的交换响应不写凭据。网页版仍需本人确认授权；本轮未修改或部署授权网页。

桌面在 Electron userData 下保存安全凭据、`state.json` 和独立 `codex/`。旧桌面已记录的会话可从旧全局 sessions 目录复制到独立目录；不搬走或删除原文件。旧配置备份保留。

CLI 在 `%LOCALAPPDATA%/BotGo/Agent` 下维护安装版本、`current.json`、`previous.json`、会话元数据与独立 Codex 配置；设备 token 进入系统凭据库。

## 分发

本轮候选为 Desktop 1.2.1-preview.2 / CLI 0.2.1，不表示 current 已激活。Desktop preview.1 遗漏运行二进制，不可发布；preview.2 增加打包后全量运行文件哈希及包内 Codex 启动检查。Windows 原生终端使用 `agent/lib/windows-console.ps1` 创建独立控制台并回报生命周期；`TERM=dumb` 只在确认 Windows 交互控制台后修正。Desktop 原生终端与图形任务禁止同时启动。

`powershell -NoProfile -File desktop/scripts/package-preview.ps1` 使用固定自签名身份打包：非导出私钥存当前用户个人证书库，公开指纹保存在忽略目录。自签名没有系统默认信任，不安装根证书；安装/升级/卸载与本人任务验收后才允许激活。包版本和验证限制见 [[Release 2026-09-12]]。

`install.ps1` 检测受支持 Node/npm，必要时安装固定官方 Node 22.23.2 到 BotGo 用户目录；先验证 zip 哈希和运行环境，再切换版本。`agent/scripts/package.ps1` 生成 zip 和元数据；R2 `agent/` 前缀经专用公开 Worker 路由分发，不开放 bucket。

重跑安装命令可更新/修复；旧版本留存。桌面安装包继续通过原登录下载入口提供，appId 保持 `com.botgo.desktop`。新文件必须计算新 SHA-256。

验收：真实无 Node 安装、现有 Node 复用、中文目录、授权、凭据库、任务执行/停止/恢复、长中文结果、升级失败保留旧版、原生窗口。
