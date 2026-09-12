(() => {
  "use strict";

  const allowedViews = new Set(["chat", "agents", "tutorials"]);
  const params = new URLSearchParams(window.location.search);
  const localPreviewHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const accountPreview = localPreviewHost && params.get("preview") === "account";
  const openedFromLegacySubscription = params.get("view") === "subscription";
  const returnedOutTradeNo = params.get("out_trade_no") || "";
  let activeView = allowedViews.has(params.get("view")) ? params.get("view") : "chat";
  let account = null;
  let messages = [];
  let verificationPurpose = "register";

  const authDialog = document.getElementById("auth-dialog");
  const desktopInstallDialog = document.getElementById("desktop-install-dialog");
  const subscriptionDialog = document.getElementById("subscription-dialog");
  const authTitle = document.getElementById("auth-title");
  const authEyebrow = document.getElementById("auth-eyebrow");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const verifyForm = document.getElementById("verify-form");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const chatLog = document.getElementById("chat-log");
  const welcomeView = document.getElementById("welcome-view");
  const composerNote = document.getElementById("composer-note");
  const themeToggle = document.getElementById("theme-toggle");
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  const prefersDarkTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let savedThemePreference = null;
  let chatSending = false;

  function currentTheme() {
    return document.documentElement.dataset.theme || (prefersDarkTheme.matches ? "dark" : "light");
  }

  function renderThemeToggle() {
    const nextTheme = currentTheme() === "dark" ? "light" : "dark";
    const themeLabel = `切换至${nextTheme === "dark" ? "夜间" : "日间"}模式`;
    themeToggle.setAttribute("aria-label", themeLabel);
    themeToggle.title = themeLabel;
    themeToggle.setAttribute("aria-pressed", String(currentTheme() === "dark"));
    themeColorMeta?.setAttribute("content", currentTheme() === "dark" ? "#06182b" : "#d7efff");
  }

  function applyTheme(theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    savedThemePreference = nextTheme;
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    try { localStorage.setItem("botgo-theme", nextTheme); } catch {}
    renderThemeToggle();
  }

  function syncThemeFromPreference() {
    const resolvedTheme = savedThemePreference || (prefersDarkTheme.matches ? "dark" : "light");
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    renderThemeToggle();
  }

  try {
    const savedTheme = localStorage.getItem("botgo-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      savedThemePreference = savedTheme;
    }
  } catch {}
  syncThemeFromPreference();
  async function loadDesktopRelease() {
    const releasePanel = document.getElementById("desktop-release");
    const loginButton = document.getElementById("desktop-download-login");
    const status = document.getElementById("desktop-install-status");
    releasePanel.hidden = true;
    loginButton.hidden = Boolean(account);
    if (!account) {
      status.textContent = "请先登录 BotGo 账号，再获取受保护的安装包。";
      return;
    }
    status.textContent = "正在获取最新版本…";
    try {
      const result = await api("/desktop/releases/current");
      if (!result.release) throw new Error("当前没有可下载的桌面版本。");
      const release = result.release;
      document.getElementById("desktop-download-link").href = release.downloadUrl;
      releasePanel.hidden = false;
      status.textContent = "安装包已准备好。";
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function openDesktopInstall() {
    if (!desktopInstallDialog.open) desktopInstallDialog.showModal();
    loadDesktopRelease();
  }

  function updateUrl() {
    const next = new URL(window.location.href);
    next.searchParams.set("view", activeView);
    next.searchParams.delete("agent");
    next.searchParams.delete("os");
    history.replaceState({ view: activeView }, "", next);
  }

  function setView(view, updateHistory) {
    activeView = allowedViews.has(view) ? view : "chat";
    document.body.dataset.activeView = activeView;
    document.querySelectorAll("[data-view]").forEach((section) => {
      section.hidden = section.dataset.view !== activeView;
    });
    document.querySelectorAll("[data-view-link]").forEach((button) => {
      button.setAttribute("aria-current", button.dataset.viewLink === activeView ? "page" : "false");
    });
    if (updateHistory) updateUrl();
  }

  function formatBalance(balanceCents) {
    const cents = Number(balanceCents);
    if (!Number.isFinite(cents)) return "—";
    return `￥${(Math.round(cents) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function renderAccountState() {
    const accountButton = document.getElementById("account-button");
    const accountPopover = document.getElementById("account-popover");
    const accountMenu = document.getElementById("account-menu");
    const accountStatus = document.getElementById("account-status");
    const loginButton = document.getElementById("login-button");
    const registerButton = document.getElementById("register-button");
    const balanceCents = account ? Number(account.balanceCents ?? Math.round(Number(account.credits || 0) * 100)) : 0;
    const balance = account ? formatBalance(balanceCents) : "—";
    const summary = account ? `余额 ${balance}` : "登录后开始对话";
    composerNote.textContent = account ? summary : "登录后开始对话";
    accountPopover.hidden = !account;
    loginButton.hidden = Boolean(account);
    registerButton.hidden = Boolean(account);
    if (account) {
      const avatar = (account.email || "账户").trim().charAt(0).toUpperCase();
      document.querySelectorAll("[data-account-avatar]").forEach((node) => { node.textContent = avatar; });
      document.querySelectorAll("[data-account-email]").forEach((node) => { node.textContent = account.email; });
      accountStatus.textContent = summary;
      setAccountMenu(false);
    } else {
      accountMenu.hidden = true;
      accountButton.setAttribute("aria-expanded", "false");
    }
    document.querySelectorAll("[data-billing-balance]").forEach((node) => { node.textContent = account ? balance : "—"; });
    document.querySelectorAll("[data-billing-account-state]").forEach((node) => { node.textContent = account ? "可用" : "未登录"; });
    document.querySelectorAll("[data-subscription-status]").forEach((node) => { node.textContent = account ? "余额可用于网页对话与桌面端任务。" : "登录后查看余额并充值。"; });
  }

  function setAccountMenu(open) {
    const accountMenu = document.getElementById("account-menu");
    const accountButton = document.getElementById("account-button");
    accountMenu.hidden = !open;
    accountButton.setAttribute("aria-expanded", String(open));
  }

  function openSubscriptionDialog() {
    setAccountMenu(false);
    if (!subscriptionDialog.open) subscriptionDialog.showModal();
  }

  async function reconcileReturnedOrder() {
    if (!returnedOutTradeNo) return;
    await api("/billing/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outTradeNo: returnedOutTradeNo })
    });
  }

  function resetStatuses() {
    document.querySelectorAll(".form-status").forEach((node) => {
      node.textContent = "";
      node.className = "form-status";
    });
  }

  function showAuth(mode) {
    const isRegister = mode === "register";
    loginForm.hidden = isRegister;
    registerForm.hidden = !isRegister;
    verifyForm.hidden = true;
    authEyebrow.textContent = isRegister ? "BOTGO ACCOUNT / INVITE" : "BOTGO ACCOUNT";
    authTitle.textContent = isRegister ? "创建 BotGo 账户" : "登录 BotGo";
    document.querySelectorAll(".auth-mode-switch [data-auth-mode]").forEach((button) => {
      button.setAttribute("aria-current", button.dataset.authMode === mode ? "page" : "false");
    });
    resetStatuses();
    if (!authDialog.open) authDialog.showModal();
    window.requestAnimationFrame(() => {
      const firstInput = (isRegister ? registerForm : loginForm).querySelector("input");
      if (firstInput) firstInput.focus();
    });
  }

  function showVerification(email, purpose) {
    verificationPurpose = purpose;
    loginForm.hidden = true;
    registerForm.hidden = true;
    verifyForm.hidden = false;
    authEyebrow.textContent = "BOTGO ACCOUNT / VERIFY";
    authTitle.textContent = purpose === "login" ? "登录验证码" : "验证你的邮箱";
    verifyForm.elements.email.value = email;
    verifyForm.elements.code.focus();
  }

  function setStatus(id, message, isError) {
    const target = document.getElementById(id);
    target.textContent = message;
    target.className = `form-status${isError ? " is-error" : " is-success"}`;
  }

  async function api(path, options) {
    const response = await fetch(`/api${path}`, { credentials: "same-origin", ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "请求未完成，请稍后重试。");
    return body;
  }

  function appendMessage(role, content, modifier) {
    const message = document.createElement("article");
    message.className = `chat-message chat-message--${modifier || role}`;
    message.textContent = content;
    chatLog.appendChild(message);
    message.scrollIntoView({ block: "end", behavior: "smooth" });
    return message;
  }

  function resetConversation() {
    messages = [];
    chatLog.textContent = "";
    welcomeView.hidden = false;
    setView("chat", true);
    chatInput.focus();
  }

  async function consumeStream(response, target) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    const applyEvent = (data) => {
      if (!data || data === "[DONE]") return;
      try {
        const payload = JSON.parse(data);
        const delta = payload.choices?.[0]?.delta?.content;
        if (delta) { answer += delta; target.textContent = answer; }
      } catch { /* 忽略上游 SSE 保活事件。 */ }
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach((line) => { if (line.startsWith("data:")) applyEvent(line.slice(5).trim()); });
      if (done) break;
    }
    if (buffer.startsWith("data:")) applyEvent(buffer.slice(5).trim());
    return answer;
  }

  async function submitChat(event) {
    event.preventDefault();
    if (chatSending) return;
    const content = chatInput.value.trim();
    if (!content) return;
    if (!account) { showAuth("login"); return; }
    welcomeView.hidden = true;
    chatInput.value = "";
    messages.push({ role: "user", content });
    appendMessage("user", content);
    const responseNode = appendMessage("assistant", "正在连接模型…");
    const sendButton = chatForm.querySelector('[type="submit"]');
    chatSending = true;
    sendButton.disabled = true;
    sendButton.setAttribute("aria-busy", "true");
    try {
      const response = await fetch("/api/chat/stream", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "gpt-5.6", messages })
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "对话请求未完成。");
      }
      const answer = await consumeStream(response, responseNode);
      if (answer) messages.push({ role: "assistant", content: answer });
      else responseNode.textContent = "模型没有返回内容，请重试。";
    } catch (error) {
      responseNode.textContent = error.message;
      responseNode.classList.add("chat-message--notice");
    } finally {
      chatSending = false;
      sendButton.disabled = false;
      sendButton.removeAttribute("aria-busy");
      chatInput.focus();
    }
  }

  document.querySelectorAll("[data-view-link]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewLink, true)));
  document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => showAuth(button.dataset.authMode)));
  document.querySelectorAll("[data-desktop-open]").forEach((button) => button.addEventListener("click", openDesktopInstall));
  themeToggle.addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark"));
  prefersDarkTheme.addEventListener("change", () => {
    if (!savedThemePreference) syncThemeFromPreference();
  });
  document.getElementById("desktop-install-close").addEventListener("click", () => desktopInstallDialog.close());
  document.getElementById("desktop-download-login").addEventListener("click", () => {
    desktopInstallDialog.close();
    showAuth("login");
  });
  document.getElementById("auth-close").addEventListener("click", () => authDialog.close());
  document.getElementById("subscription-close").addEventListener("click", () => subscriptionDialog.close());
  subscriptionDialog.addEventListener("close", () => {
    const accountButton = document.getElementById("account-button");
    if (account && !document.getElementById("account-popover").hidden) accountButton.focus();
  });
  document.getElementById("new-chat-button").addEventListener("click", resetConversation);
  document.getElementById("account-button").addEventListener("click", () => {
    const accountMenu = document.getElementById("account-menu");
    setAccountMenu(accountMenu.hidden);
  });
  document.querySelector("[data-open-subscription]").addEventListener("click", () => {
    openSubscriptionDialog();
  });
  document.addEventListener("click", (event) => {
    const accountPopover = document.getElementById("account-popover");
    const accountMenu = document.getElementById("account-menu");
    if (!accountMenu.hidden && !accountPopover.contains(event.target)) setAccountMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    const accountMenu = document.getElementById("account-menu");
    if (event.key === "Escape" && !accountMenu.hidden) {
      setAccountMenu(false);
      document.getElementById("account-button").focus();
    }
  });
  chatForm.addEventListener("submit", submitChat);
  chatInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    chatForm.requestSubmit();
  });
  window.addEventListener("popstate", () => {
    const next = new URLSearchParams(window.location.search);
    const openedFromLegacySubscription = next.get("view") === "subscription";
    setView(allowedViews.has(next.get("view")) ? next.get("view") : "chat", false);
    if (openedFromLegacySubscription) openSubscriptionDialog();
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault(); setStatus("login-status", "正在发送验证码…", false);
    const data = Object.fromEntries(new FormData(loginForm));
    try { await api("/auth/request-login-code", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(data) }); showVerification(data.email, "login"); setStatus("verify-status", "验证码已发送，请检查邮箱。", false); }
    catch (error) { setStatus("login-status", error.message, true); }
  });
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault(); setStatus("register-status", "正在发送验证码…", false); const data = Object.fromEntries(new FormData(registerForm));
    try { await api("/auth/redeem-invite", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(data) }); showVerification(data.email, "register"); setStatus("verify-status", "验证码已发送，请检查邮箱。", false); }
    catch (error) { setStatus("register-status", error.message, true); }
  });
  verifyForm.addEventListener("submit", async (event) => {
    event.preventDefault(); setStatus("verify-status", "正在验证邮箱…", false);
    const data = Object.fromEntries(new FormData(verifyForm));
    data.code = String(data.code || "").trim().replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xfee0));
    try { const result = await api(verificationPurpose === "login" ? "/auth/login" : "/auth/verify-email", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(data) }); account = result.account; renderAccountState(); authDialog.close(); }
    catch (error) { setStatus("verify-status", error.message, true); }
  });

  setView(activeView, true);
  if (accountPreview) {
    account = { email: "preview@botgo.local", balanceCents: 102000 };
    renderAccountState();
    openSubscriptionDialog();
  } else if (openedFromLegacySubscription) {
    openSubscriptionDialog();
  }
  async function refreshAccount() {
    if (accountPreview) return;
    try {
      if (returnedOutTradeNo) await reconcileReturnedOrder();
      const result = await api("/account");
      account = result.account;
      renderAccountState();
    } catch {
      renderAccountState();
    }
  }
  window.addEventListener("botgo:account-refresh", refreshAccount);
  refreshAccount();
})();
