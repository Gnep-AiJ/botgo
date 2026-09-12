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
- 共用配置参数固定 BotGo provider、GPT-5.6、Responses 与服务域名；原生配置其余设置保留。
- CLI：`botgo auth login`、`botgo account`、`botgo run`、`botgo resume`、`botgo sessions`、`botgo codex -- <参数>`。
- 终端会话与图形会话不做实时双向同步；已有 session ID 可在终端恢复。
- Windows 停止操作只结束当前 Codex 进程树；退出桌面会停止当前图形任务。

## 数据与迁移

桌面在 Electron userData 下保存安全凭据、`state.json` 和独立 `codex/`。旧桌面已记录的会话可从旧全局 sessions 目录复制到独立目录；不搬走或删除原文件。旧配置备份保留。

CLI 在 `%LOCALAPPDATA%/BotGo/Agent` 下维护安装版本、`current.json`、`previous.json`、会话元数据与独立 Codex 配置；设备 token 进入系统凭据库。

## 分发

`install.ps1` 检测受支持 Node/npm，必要时安装固定官方 Node 22.23.2 到 BotGo 用户目录；先验证 zip 哈希和运行环境，再切换版本。`agent/scripts/package.ps1` 生成 zip 和元数据；R2 `agent/` 前缀经专用公开 Worker 路由分发，不开放 bucket。

重跑安装命令可更新/修复；旧版本留存。桌面安装包继续通过原登录下载入口提供，appId 保持 `com.botgo.desktop`。新文件必须计算新 SHA-256。

验收：真实无 Node 安装、现有 Node 复用、中文目录、授权、凭据库、任务执行/停止/恢复、长中文结果、升级失败保留旧版、原生窗口。
