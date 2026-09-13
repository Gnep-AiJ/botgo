---
type: atomic-note
topic: dev-preview
tags: [botgo, tooling, preview, troubleshooting]
---

# Dev Preview

## 唯一服务

`npm run dev` → `scripts/dev.mjs`：启动前构建 `dist/`，再提供静态文件和 `/__botgo-reload` 热刷新端点。默认地址是 `http://127.0.0.1:4173`。

`package.json` 不再有 Python `preview`/`preview:lan` 脚本；这样不会出现两个服务竞争同一端口或一个服务返回旧构建产物。

## 局域网

```powershell
$env:BOTGO_DEV_HOST = "0.0.0.0"
npm run dev
```

只在可信私有网络共享；不要为了局域网预览修改业务代码或启动第二个静态服务器。

## 为什么会反复重建

开发服务使用递归监听，忽略 `desktop/`、`worker/`、`docs/`、`tests/`、`dist/`、`agent/`、`artifacts/`、凭据及工具缓存目录。新浏览器 profile、截图、日志和隔离安装结果统一写入 `artifacts/verification/`。旧 `.tmp-`、`tmp-`、`layout-`、`debug-` 前缀继续兼容。

隔离后台发布使用 `node scripts/prepare-admin-release.mjs artifacts/<baseline> artifacts/<output>`。基准与输出必须是 artifacts 下互不包含的独立目录；输出必须尚不存在。

## 排障顺序

1. `netstat -ano | Select-String ":4173"`，确认只有一个监听进程。
2. 关闭旧的 Node/Python 预览实例，再运行 `npm run dev`。
3. 删除本轮生成的临时截图或 profile，不要删除源码、`assets/` 或整个 `dist/`。
4. 单独运行 `npm run build`，确认构建可重复。
5. 再运行 `npm test`；`tests/dev-preview.test.mjs` 会用临时端口启动独立实例。
