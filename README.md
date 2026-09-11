# BotGo

BotGo 科技品牌官网首页。页面以两段电影式开场介绍品牌愿景，并通过四个真实小型业务案例展示网站、Agent、业务工具和自动化流程。

## 本地预览

```bash
npm run dev
```

访问 `http://localhost:4173`。点击左上角 BotGo Logo 可以重新播放开场。

开发服务会先构建 `dist/`，随后监听 `http://127.0.0.1:4173`，并在源文件变化后自动重建和刷新。项目只保留这一套预览服务，避免静态 Python 服务与开发服务同时占用同一端口。

项目结构与 AI/人工接手入口见 [`docs/PROJECT_MAP.md`](docs/PROJECT_MAP.md)；工作台专门规则见 [`docs/notes/UI Workspace.md`](docs/notes/UI%20Workspace.md)。

如需在同一私有网络共享预览，在 PowerShell 中设置绑定地址后仍使用同一服务：

```powershell
$env:BOTGO_DEV_HOST = "0.0.0.0"
npm run dev
```

然后在同一私有网络的设备访问 `http://<本机局域网 IPv4>:4173`。当前网络若被 Windows 标记为“公用”，不要创建入站放行规则；切换到可信的私有网络后再共享预览。

## 上线检查

```bash
npm run check
npm run build
```

生产文件输出到 `dist/`。构建脚本只复制页面实际使用的文件，不会将历史图片和源素材带入部署包。

## Cloudflare Pages

项目名称为 `botgo`，生产分支为 `main`。

```bash
npx --yes wrangler@4.111.0 pages project create botgo --production-branch main
npm run deploy
```

Cloudflare Pages 会读取 `dist/_headers`，为页面添加安全响应头，并对带版本号的静态资源启用长期缓存。
