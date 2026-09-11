(() => {
  "use strict";
  async function loadPlan() { try { const response = await fetch("/api/billing/plan", { credentials: "same-origin" }); const data = await response.json(); if (!response.ok || !data.plan) throw new Error(); document.querySelector("[data-pro-name]").textContent = data.plan.name || "Pro"; const price = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(data.plan.price_cents / 100); document.getElementById("subscription-upgrade-note").textContent = `${price} / 30 天，含 ${data.plan.included_credits} 额度`; const button = document.querySelector("[data-subscription-upgrade]"); button.disabled = !data.paymentAvailable; button.textContent = data.paymentAvailable ? "购买 Pro" : "支付未开放"; } catch { document.getElementById("subscription-upgrade-note").textContent = "套餐信息暂不可用"; } }
  loadPlan();
})();
