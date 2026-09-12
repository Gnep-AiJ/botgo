(() => {
  "use strict";

  const button = document.querySelector("[data-subscription-upgrade]");
  const note = document.getElementById("subscription-upgrade-note");
  const status = document.getElementById("subscription-payment-status");
  const formContainer = document.getElementById("alipay-form-container");
  const amountInput = document.getElementById("recharge-amount");
  const optionButtons = [...document.querySelectorAll("[data-recharge-option]")];
  if (!button || !note || !status || !formContainer || !amountInput) return;

  const defaultRecharge = { minAmountCents: 1000, maxAmountCents: 999900, presetAmountCents: [1000, 5000, 10000] };
  let recharge = { ...defaultRecharge };
  let checkoutKey = "";
  let checkoutAmountCents = null;
  let checkoutInFlight = false;
  let paymentAvailable = false;
  let paymentWindow = null;
  let orderPollTimer = 0;
  let orderPollDeadline = 0;

  function setStatus(message = "", kind = "") {
    status.textContent = message;
    status.className = `subscription-status${kind ? ` is-${kind}` : ""}`;
  }

  function formatCny(cents) {
    return `￥${(Number(cents) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function parseAmountCents(value) {
    const text = String(value ?? "").trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
    const [whole, fraction = ""] = text.split(".");
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return Number.isSafeInteger(cents) ? cents : null;
  }

  function amountIsValid(cents) {
    return Number.isInteger(cents) && cents >= recharge.minAmountCents && cents <= recharge.maxAmountCents;
  }

  function syncAmountState() {
    const cents = parseAmountCents(amountInput.value);
    const valid = amountIsValid(cents);
    amountInput.setAttribute("aria-invalid", String(!valid));
    button.disabled = checkoutInFlight || !paymentAvailable || !valid;
    amountInput.disabled = checkoutInFlight;
    optionButtons.forEach((option, index) => {
      option.disabled = checkoutInFlight;
      const selected = valid && Number(option.dataset.amountCents) === cents;
      option.setAttribute("aria-checked", String(selected));
      option.tabIndex = selected || (!valid && index === 0) ? 0 : -1;
    });
    return cents;
  }

  function clearCheckoutKey() {
    checkoutKey = "";
    checkoutAmountCents = null;
  }

  function resetKeyIfAmountChanged(cents) {
    if (!checkoutInFlight && checkoutKey && checkoutAmountCents !== null && cents !== checkoutAmountCents) clearCheckoutKey();
  }

  function selectAmount(cents) {
    if (!Number.isInteger(cents)) return;
    amountInput.value = (cents / 100).toFixed(2);
    syncAmountState();
    amountInput.focus();
  }

  function newCheckoutKey() {
    if (globalThis.crypto?.randomUUID) return `web-${globalThis.crypto.randomUUID()}`;
    return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  async function readJson(response) {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "请求未完成，请稍后重试。");
      error.status = response.status;
      error.code = data.code;
      throw error;
    }
    return data;
  }

  async function loadPlan() {
    try {
      const data = await readJson(await fetch("/api/billing/plan", { credentials: "same-origin", cache: "no-store" }));
      recharge = { ...defaultRecharge, ...(data.recharge || {}) };
      amountInput.min = String(recharge.minAmountCents / 100);
      amountInput.max = String(recharge.maxAmountCents / 100);
      note.textContent = `最低 ${formatCny(recharge.minAmountCents)}，最高 ${formatCny(recharge.maxAmountCents)}，支持两位小数。`;
      paymentAvailable = data.paymentAvailable === true;
      syncAmountState();
      button.textContent = paymentAvailable ? "支付宝充值" : "支付未开放";
      if (!paymentAvailable && data.reason === "unsupported_sign_type") setStatus("充值暂不可用，请稍后重试。", "error");
      if (!paymentAvailable && data.reason === "invalid_public_key_role") setStatus("充值暂不可用，请稍后重试。", "error");
      if (!paymentAvailable && data.reason === "invalid_key_material") setStatus("充值暂不可用，请稍后重试。", "error");
    } catch (error) {
      paymentAvailable = false;
      button.disabled = true;
      button.textContent = "暂不可充值";
      note.textContent = error.message || "充值规则暂不可用";
      setStatus("充值服务暂不可用，请稍后重试。", "error");
    }
  }

  function openLoginDialog() {
    const loginButton = document.querySelector('[data-auth-mode="login"]');
    if (loginButton) loginButton.click();
  }

  function openPaymentWindow() {
    const popup = window.open("about:blank", "_blank", "popup,width=480,height=760,resizable=yes,scrollbars=yes");
    if (!popup) throw new Error("支付宝窗口未打开，请允许浏览器弹出窗口后重试。");
    paymentWindow = popup;
    try { popup.focus(); } catch {}
    return popup;
  }

  function submitPaymentForm(paymentHtml, popup) {
    const markup = paymentHtml.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    const popupDocument = popup.document;
    popupDocument.open();
    popupDocument.write(markup);
    popupDocument.close();
    const form = popupDocument.forms.namedItem("alipaySubmit");
    if (!(form instanceof popup.HTMLFormElement)) throw new Error("支付宝支付表单无效。");
    popup.HTMLFormElement.prototype.submit.call(form);
    try { popup.focus(); } catch {}
  }

  function navigateToPayment(paymentUrl, popup) {
    const target = new URL(paymentUrl, window.location.href);
    if (target.protocol !== "https:") throw new Error("支付宝支付地址无效。");
    popup.location.replace(target.href);
    try { popup.focus(); } catch {}
  }

  function stopOrderPolling() {
    if (orderPollTimer) window.clearInterval(orderPollTimer);
    orderPollTimer = 0;
    orderPollDeadline = 0;
  }

  function finishPayment(statusMessage, kind = "", { resetKey = false } = {}) {
    stopOrderPolling();
    checkoutInFlight = false;
    if (resetKey) clearCheckoutKey();
    button.removeAttribute("aria-busy");
    syncAmountState();
    setStatus(statusMessage, kind);
    window.dispatchEvent(new CustomEvent("botgo:account-refresh"));
  }

  async function pollOrder(outTradeNo) {
    if (!outTradeNo || Date.now() >= orderPollDeadline) {
      finishPayment("等待支付超时，请确认支付宝订单状态后重试。", "error");
      return;
    }
    try {
      const response = await fetch("/api/billing/query", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outTradeNo })
      });
      const data = await readJson(response);
      const orderStatus = data.order?.status || data.paymentState;
      if (orderStatus === "paid" || data.paymentState === "paid") {
        finishPayment("充值成功，余额正在刷新。", "success", { resetKey: true });
      } else if (orderStatus === "closed" || data.paymentState === "closed") {
        finishPayment("订单已关闭，余额未增加。", "error", { resetKey: true });
      } else {
        setStatus(paymentWindow?.closed ? "支付宝窗口已关闭，仍在等待订单结果…" : "请在新打开的支付宝窗口完成充值…");
      }
    } catch (error) {
      if (error.status === 401) {
        stopOrderPolling();
        checkoutInFlight = false;
        syncAmountState();
        button.removeAttribute("aria-busy");
        setStatus("登录状态已失效，请重新登录后查询订单。", "error");
      }
    }
  }

  function watchOrder(outTradeNo) {
    stopOrderPolling();
    orderPollDeadline = Date.now() + 10 * 60 * 1000;
    setStatus("请在新打开的支付宝窗口完成充值…");
    pollOrder(outTradeNo);
    orderPollTimer = window.setInterval(() => pollOrder(outTradeNo), 3000);
  }

  async function startCheckout() {
    const amountCents = syncAmountState();
    if (!amountIsValid(amountCents)) {
      setStatus(`请输入 ${formatCny(recharge.minAmountCents)} 至 ${formatCny(recharge.maxAmountCents)} 的充值金额。`, "error");
      amountInput.focus();
      return;
    }
    if (!paymentAvailable || button.disabled) return;
    if (!checkoutKey) checkoutKey = newCheckoutKey();
    checkoutAmountCents = amountCents;
    checkoutInFlight = true;
    button.disabled = true;
    amountInput.disabled = true;
    optionButtons.forEach((option) => { option.disabled = true; });
    button.setAttribute("aria-busy", "true");
    setStatus("正在创建充值订单…");
    let paymentNavigationStarted = false;
    let popup;
    try {
      popup = openPaymentWindow();
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: checkoutKey, amountCents })
      });
      const data = await readJson(response);
      const outTradeNo = data.order?.outTradeNo || "";
      if (data.paymentUrl) {
        setStatus("正在打开支付宝收银台…");
        navigateToPayment(data.paymentUrl, popup);
        paymentNavigationStarted = true;
        watchOrder(outTradeNo);
        return;
      }
      if (data.paymentHtml) {
        setStatus("正在打开支付宝收银台…");
        submitPaymentForm(data.paymentHtml, popup);
        paymentNavigationStarted = true;
        watchOrder(outTradeNo);
        return;
      }
      if (popup && !popup.closed) popup.close();
      if (data.order?.status === "paid") finishPayment("该订单已经充值完成。", "success", { resetKey: true });
      else finishPayment("充值订单已创建，请查询支付状态。", "success");
    } catch (error) {
      if (popup && !paymentNavigationStarted && !popup.closed) popup.close();
      if (error.status === 401) {
        setStatus("请先登录 BotGo 账户，再继续充值。", "error");
        openLoginDialog();
      } else {
        setStatus(error.message || "充值请求未完成，请稍后重试。", "error");
      }
    } finally {
      if (paymentNavigationStarted) return;
      checkoutInFlight = false;
      button.removeAttribute("aria-busy");
      syncAmountState();
    }
  }

  optionButtons.forEach((option) => option.addEventListener("click", () => {
    selectAmount(Number(option.dataset.amountCents));
    resetKeyIfAmountChanged(parseAmountCents(amountInput.value));
  }));
  optionButtons.forEach((option, index) => option.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? optionButtons.length - 1
        : (index + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + optionButtons.length) % optionButtons.length;
    selectAmount(Number(optionButtons[nextIndex].dataset.amountCents));
    resetKeyIfAmountChanged(parseAmountCents(amountInput.value));
    optionButtons[nextIndex].focus();
  }));
  amountInput.addEventListener("input", () => {
    const cents = syncAmountState();
    resetKeyIfAmountChanged(cents);
  });
  amountInput.addEventListener("blur", () => {
    const cents = parseAmountCents(amountInput.value);
    if (amountIsValid(cents)) amountInput.value = (cents / 100).toFixed(2);
  });
  button.addEventListener("click", startCheckout);
  window.addEventListener("botgo:account-refresh", loadPlan);
  syncAmountState();
  loadPlan();
})();
