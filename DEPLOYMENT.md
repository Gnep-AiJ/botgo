# BotGo 发布

当前证据：[Release 2026-09-12](docs/notes/Release%202026-09-12.md)。

使用现有 Pages `botgo`、Worker `botgo-api`、D1 `botgo`、私有 R2 `botgo-desktop-releases`。网站域名 `https://botgo.win`，GitHub `Gnep-AiJ/botgo`。保留 Git 历史、应用身份和下载入口。

现有 Secrets：`AUTH_SECRET`、`ADMIN_EMAIL`、`QQ_SMTP_USER`、`QQ_SMTP_AUTH_CODE`、`UPSTREAM_CONFIG_KEY`。`UPSTREAM_API_KEY` 为旧上游回退凭据；主要上游由后台加密配置并分别测试 Chat/Responses 路由。`UPSTREAM_CONFIG_KEY` 必须保留，否则无法解密已有配置。支付密钥按 `docs/ALIPAY_PAYMENT.md` 管理。

## 验证

```powershell
npm test
npm run check
git diff --check
```

Wrangler 固定使用项目脚本指定的 4.125.0。发布前核对账户/绑定、远程迁移、当前版本，并将 D1 导出放入已忽略的 `.secrets/`。0013 只应用一次，将历史元单位余额转成分；随后应用 0014，加入精细计费账本与模型目录。

## 顺序

1. 提交审查后的源码、测试与文档，验证 GitHub 远端提交。
2. 本轮需要明确批准 main 更新和短暂 API 维护窗口，见当前发布记录。备份 D1 后先部署维护模式（`BOTGO_MAINTENANCE=1`），再运行 `npm run migrate:worker`；部署与分单位余额兼容的最终 Worker 并明确设置 `BOTGO_MAINTENANCE=0`，验证健康和余额契约。不要在旧 Worker 仍接受请求时直接迁移余额单位。
3. `npm --prefix agent run package:win`；将 zip 上传到 R2 `agent/<version>/botgo-agent-win-x64.zip`。下载校验通过后才更新 `agent/current.json`。
4. 桌面：设置 `BOTGO_API_ORIGIN=https://botgo.win` 后执行 `npm --prefix desktop run package:win`；签名及干净机器验证完成后计算最终哈希、上传 R2，再登记/激活发布元数据。
5. `npm run build`、`npm run deploy:pages`；检查健康接口、账户、CLI 安装脚本与版本包、桌面下载、一次真实中转任务和余额。

完整 `npm run deploy` 会执行迁移及 Worker/Pages 发布，不能在未完成备份与兼容核查时盲目执行。

## 回滚与边界

2026-09-12 只读核查发现生产尚无 upstream_profiles/upstream_routes。首次初始化入口为 `worker/scripts/bootstrap-metering.js`：仅返回维护 503；同时满足维护标记与本轮发布标记时，定时事件才使用现有 Worker 密钥加密导入配置、实际探测六个模型并启用通过者。已有路由直接拒绝，审计主键保证只执行一次。失败会保留审计与禁用状态，不能删审计后盲目重跑。它不是正式 Worker 入口，也不提供公开管理接口。

该入口的生产部署被自动审批拒绝，尚未执行。批准后需明确短暂维护、0013/0014、临时每分钟调度及探测范围。初始化结束后用正常 `worker/wrangler.jsonc` 部署 `BOTGO_MAINTENANCE=0`、`BOTGO_RELEASE_BOOTSTRAP=0`，显式清空 cron 并核验，避免留下临时任务。生产数据已迁移后不得恢复旧元单位代码。

保留上一份 CLI manifest、安装目录和桌面发布记录。代码回滚不会回滚 D1，0013 后不能直接恢复使用元单位的旧 Worker；需要对应的兼容版本或按备份受控恢复。

Worker Secrets 不进入仓库、参数或日志。支付宝配置及真实付款状态见支付文档和当前发布记录。未签名桌面包不能标记为正式签名版本；本地 HTTP、测试成功不代表生产登录/扣费/安装已通过。
