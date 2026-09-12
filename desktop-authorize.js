(() => {
  const query = new URLSearchParams(window.location.search);
  const requestId = query.get("request") || "";
  const state = query.get("state") || "";
  const callbackValue = query.get("callback") || "";
  const isAgentClient = query.get("client") === "agent";
  const $ = (selector) => document.querySelector(selector);
  const status = (message, isError = false) => {
    const element = $("[data-status]");
    element.textContent = message || "";
    element.classList.toggle("error", isError);
  };
  const api = async (endpoint, options = {}) => {
    const response = await fetch(`/api${endpoint}`, { credentials: "same-origin", ...options, headers: { "content-type": "application/json", ...(options.headers || {}) } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || "BotGo 服务暂不可用。"), { status: response.status });
    return result;
  };
  const callback = (() => {
    try {
      const value = new URL(callbackValue);
      return value.protocol === "http:" && value.hostname === "127.0.0.1" && value.pathname === "/callback" && /^\d{1,5}$/.test(value.port) ? value : null;
    } catch { return null; }
  })();
  let email = "";

  function applyClientCopy() {
    if (!isAgentClient) return;
    document.title = "授权 BotGo Agent";
    $("[data-client-label]").textContent = "BOTGO AGENT";
    $("[data-client-heading]").textContent = "在浏览器中确认 BotGo Agent 登录";
    $("[data-client-connection]").textContent = "将连接到 BotGo Agent CLI";
    $("[data-approve]").textContent = "授权 BotGo Agent";
    $("[data-client-return]").textContent = "确认后返回终端。";
  }

  function validateRequest() {
    return /^[A-Za-z0-9-]{1,128}$/.test(requestId) && /^[A-Za-z0-9_-]{16,256}$/.test(state) && callback;
  }

  function showLogin() {
    $("[data-login-panel]").hidden = false;
    $("[data-approval-actions]").hidden = true;
    $("[data-account-state]").hidden = true;
    $("[data-device-state]").hidden = true;
    $("[data-authorization-copy]").textContent = "未检测到 BotGo 网页登录，请先完成邮箱验证。";
  }

  function showAuthorization(result) {
    $("[data-login-panel]").hidden = true;
    $("[data-account-state]").hidden = false;
    $("[data-device-state]").hidden = false;
    $("[data-approval-actions]").hidden = false;
    $("[data-account-email]").textContent = result.account.email;
    $("[data-device-label]").textContent = result.authorization.deviceLabel;
    $("[data-authorization-copy]").textContent = isAgentClient
      ? "确认后，这台设备将获得 BotGo Agent CLI 的本地使用凭据。"
      : "确认后，这台设备将获得 BotGo Desktop 的本地使用凭据。";
    status("");
  }

  async function loadAuthorization() {
    if (!validateRequest()) {
      status(isAgentClient ? "授权链接无效。请回到终端重新开始。" : "授权链接无效。请回到 BotGo Desktop 后重新开始。", true);
      return;
    }
    try {
      showAuthorization(await api(`/desktop/authorize/request/${encodeURIComponent(requestId)}`));
    } catch (error) {
      if (error.status === 401) showLogin();
      else status(error.message, true);
    }
  }

  $("[data-email-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("email").trim();
    try {
      status("正在发送验证码…");
      await api("/auth/request-login-code", { method: "POST", body: JSON.stringify({ email: value }) });
      email = value;
      $("[data-email-form]").hidden = true;
      $("[data-code-form]").hidden = false;
      $("[data-code-form] input").focus();
      status("验证码已发送，请检查邮箱。");
    } catch (error) { status(error.message, true); }
  });

  $("[data-code-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      status("正在登录 BotGo…");
      await api("/auth/login", { method: "POST", body: JSON.stringify({ email, code: new FormData(event.currentTarget).get("code").trim() }) });
      await loadAuthorization();
    } catch (error) { status(error.message, true); }
  });

  $("[data-approve]").addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    try {
      status("正在确认授权…");
      const result = await api("/desktop/authorize/approve", { method: "POST", body: JSON.stringify({ authorizationId: requestId }) });
      callback.searchParams.set("code", result.authorizationCode);
      callback.searchParams.set("state", state);
      window.location.replace(callback.toString());
    } catch (error) {
      event.currentTarget.disabled = false;
      status(error.message, true);
    }
  });

  applyClientCopy();
  loadAuthorization();
})();
