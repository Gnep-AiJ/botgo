---
type: module
updated: 2026-09-12
tags: [botgo, account, billing]
---
# 账户与计费

上级：[[../PROJECT_MAP]] · 相关：[[Desktop and CLI]] · [[Release 2026-09-12]]

- 网站账户面板由 `workspace.html/css` 展示；`workspace-billing.js` 负责金额选择、下单和支付查询。
- 余额主字段是整数 `balanceCents`；兼容字段 `credits` 对外代表元。D1 `credit_balance` 在迁移 0013 后代表分。
- 充值范围 ￥10–￥9999，最多两位小数；服务端校验范围与整数分，浏览器回跳不能直接增加余额。
- 支付权益仅由可信验签通知或服务端主动查询确认，保留订单幂等。详情见 `docs/ALIPAY_PAYMENT.md`。
- 网页与 Codex 共用余额。当前候选源码按实际 token 用量结算，固定 100 分扣费已移除；线上状态必须查发布记录，不能由源码推断。
- 0014 保留充值的整数分接口，增加 `credit_remainder_micros` 保存不足一分的余额；总微元余额为 `credit_balance * 10000 + credit_remainder_micros`。
- 先原子预留，收到可核验的终态 usage 后结算。用量缺失不虚构扣费，记录 review 并禁用模型；详情、汇率与价格快照见 [[Models and Metering]]。
- 0013 是一次性数据转换，部署前核对远程 migration ledger 并备份，禁止手动重复执行乘以 100。

验收：支付通知重复投递不重复入账、无效签名拒绝、范围/小数校验、余额不足、任务多次请求扣费、失败退款、设备撤销后中转拒绝。
