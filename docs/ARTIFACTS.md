---
type: moc
updated: 2026-09-13
---
# 目录与产物

从 [项目地图](PROJECT_MAP.md) 按任务读取源码。这里说明文件放在哪里，不替代发布记录中的验收结论。

| 位置 | 用途 | 维护规则 |
| --- | --- | --- |
| 根目录 HTML/CSS/JS、assets/ | 网站源码及资源 | 构建直接引用，保持路径 |
| desktop/、agent/、worker/、functions/ | Desktop、CLI、API 与 Pages 代理源码 | 用户数据和凭据不属于清理对象 |
| scripts/、tests/ | 可复用工具与测试 | 临时辅助脚本不晋升为正式发布工具 |
| docs/notes/ | 模块说明与历史发布记录 | 先读 MOC 指定的当前记录 |
| docs/evidence/ | 可提交的结论、清单与恢复材料 | 不存凭据或完整浏览器 profile |
| artifacts/verification/ | 新截图、日志、隔离测试 profile | 忽略提交与开发监听；测试可能覆盖同名结果，验收后先归档 |
| artifacts/archive/2026-09-13-directory-cleanup/ | 本轮归档的旧 `.tmp-*` | 保留原名称，历史路径在此前缀下查找；脚本只作历史材料，不直接重跑 |
| artifacts/2026-09-12/、artifacts/2026-09-13/ | 已有本地验证材料 | 保留，结论以 docs/evidence 为准 |
| dist/ | 网站构建结果 | `npm run build` 重建；不手改 |
| agent/dist/、desktop/dist/ | 客户端包与构建结果 | 保留版本及回滚引用，不能整体当缓存删除 |
| .tmp-wrangler-config/、.tmp-electron-builder-cache/ | 仍被使用的工具与打包缓存 | 本轮原位保留，不按临时前缀删除 |
| .secrets/、.git/、.agents/、.codex/、.skill-archive/、依赖及其他缓存 | 凭据、历史、工具与依赖 | 本轮保留，不扫描内容做去重 |

## 最新发布证据入口

- [发布状态与限制](notes/Release%202026-09-12.md)、[线上发布结论](evidence/2026-09-13-release/final-state.json)。
- 最新网站视觉证据：归档中的 `.tmp-install-ui/`、`.tmp-public60/`。
- Desktop 真实运行准备：归档中的 `.tmp-packaged-prepare/fixed-1789279877916/`；包核验在 `.tmp-preview3-installer-check/`。
- 当前及上一网站快照：归档中的 `.tmp-release-60d48f9/`、`.tmp-release-7142b4b/`。
- 文件是否成功迁移以 [逐项结果](evidence/2026-09-13-directory-cleanup/results.json) 为准；未迁移项继续保留原路径。

Desktop 跨设备安装、升级、卸载和历史保留仍待人工验收；归档不改变这一状态。

## 清理方式

在项目根运行 `powershell -NoProfile -File scripts/organize-workspace.ps1` 只预览，不修改文件。
`-Execute` 执行固定范围清单，先记录计划，再校验归档前后逐文件 SHA-256。PowerShell 入口调用支持 Windows 长路径的 Node 实现。已有记录时拒绝重复执行；`-Execute -Resume` 仅恢复原清单中未完成或核验失败的条目，不覆盖成功项。后续清理应先审阅新清单，不删除旧记录来绕过保护。

本轮删除 4 个确认零字节的根目录发布探测文件，以及 4 份与保留版本包 SHA-256 相同的重复下载，释放 596,816,797 字节（约 569 MiB）。重复下载到保留包的映射见 [重复文件记录](evidence/2026-09-13-directory-cleanup/duplicate-copies.json)。其他用途未完全确认的材料归档保留。历史记录中的旧路径保留作为当时事实，查找时使用本页映射。
