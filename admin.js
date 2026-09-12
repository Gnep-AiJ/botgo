(() => {
  "use strict";
  const titles = { overview: "概览", upstreams: "上游与路由", accounts: "用户与邀请码", billing: "充值", releases: "桌面发布", audit: "审计日志" };
  const state = { admin: null, overview: null, invites: [], accountPage: 1 };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const api = async (path, options = {}) => { const response = await fetch(`/api${path}`, { credentials: "same-origin", ...options }); const body = await response.json().catch(() => ({})); if (!response.ok) { const error = new Error(body.error || `请求失败（${response.status}）`); error.status = response.status; throw error; } return body; };
  const jsonOptions = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const setStatus = (id, message, error = false) => { const node = document.getElementById(id); if (!node) return; node.textContent = message || ""; node.style.color = error ? "var(--danger)" : ""; };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const formatTime = (value) => value ? new Date(`${String(value).replace(" ", "T")}Z`).toLocaleString("zh-CN") : "—";
  const cell = (label, content) => `<td data-label="${label}">${content}</td>`;

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === "dark" ? "#081523" : "#f4f7fb";
    localStorage.setItem("botgo-theme", theme);
  }

  function activeView() {
    const view = location.hash.slice(1);
    return titles[view] ? view : "overview";
  }

  function renderNavigation() {
    const view = activeView();
    $$('[data-admin-view]').forEach((section) => { section.hidden = section.dataset.adminView !== view; });
    $$('[data-admin-nav]').forEach((link) => link.toggleAttribute("aria-current", link.dataset.adminNav === view));
    $("#admin-page-title").textContent = titles[view];
    document.body.classList.remove("nav-open");
    $("#admin-menu-toggle").setAttribute("aria-expanded", "false");
    window.dispatchEvent(new CustomEvent("botgo:admin-view", { detail: { view } }));
  }

  function table(headers, rows, emptyText) {
    if (!rows.length) return `<p class="empty-state">${emptyText}</p>`;
    return `<table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  }

  function inviteState(invite) {
    if (invite.redeemed_at) return "已使用";
    if (invite.expires_at && new Date(invite.expires_at) <= new Date()) return "已撤销";
    return "有效";
  }

  function renderInvites() {
    const rows = state.invites.map((invite) => { const status = inviteState(invite); return `<tr>${cell("名称", `<strong>${escapeHtml(invite.label || "未命名")}</strong>`)}${cell("额度", escapeHtml(invite.credits))}${cell("状态", `<span class="status-pill ${status === "有效" ? "success" : "neutral"}">${status}</span>`)}${cell("操作", status === "有效" ? `<div class="table-actions"><button class="table-button danger" type="button" data-revoke-invite="${escapeHtml(invite.code_hash)}">撤销</button></div>` : "—")}</tr>`; });
    $("#invite-list").innerHTML = table(["名称", "额度", "状态", "操作"], rows, "暂无邀请码");
    $$('[data-revoke-invite]').forEach((button) => button.addEventListener("click", () => revokeInvite(button.dataset.revokeInvite)));
  }

  async function loadAccounts(page = 1) {
    const form = $("#account-filter"); const params = new URLSearchParams({ page: String(page), query: form.elements.query.value, status: form.elements.status.value });
    const data = await api(`/admin/accounts?${params}`); state.accountPage = data.page;
    const rows = data.accounts.map((account) => `<tr>${cell("邮箱", `<strong>${escapeHtml(account.email)}</strong><span class="table-sub">${escapeHtml(account.role)}</span>`)}${cell("状态", `<span class="status-pill ${account.status === "active" ? "success" : "danger"}">${account.status === "active" ? "活跃" : "已暂停"}</span>`)}${cell("套餐", escapeHtml(account.plan || "Free"))}${cell("额度", escapeHtml(account.credit_balance))}${cell("到期", account.expires_at ? formatTime(account.expires_at) : "—")}${cell("操作", account.role === "admin" ? "—" : `<div class="table-actions"><button class="table-button" type="button" data-account-status="${escapeHtml(account.id)}" data-next-status="${account.status === "active" ? "suspended" : "active"}">${account.status === "active" ? "暂停" : "恢复"}</button><button class="table-button" type="button" data-grant-pro="${escapeHtml(account.id)}">开通 Pro</button></div>`)}</tr>`);
    $("#account-list").innerHTML = table(["账户", "状态", "套餐", "额度", "到期", "操作"], rows, "没有符合条件的账户");
    $("#account-pagination").innerHTML = `<button class="button secondary compact" type="button" data-account-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>上一页</button><span class="button ghost compact">${data.page} / ${data.pages}</span><button class="button secondary compact" type="button" data-account-page="${data.page + 1}" ${data.page >= data.pages ? "disabled" : ""}>下一页</button>`;
    $$('[data-account-page]').forEach((button) => button.addEventListener("click", () => loadAccounts(Number(button.dataset.accountPage))));
    $$('[data-account-status]').forEach((button) => button.addEventListener("click", () => updateAccountStatus(button.dataset.accountStatus, button.dataset.nextStatus)));
    $$('[data-grant-pro]').forEach((button) => button.addEventListener("click", () => grantPro(button.dataset.grantPro)));
  }

  async function revokeInvite(codeHash) {
    if (!confirm("撤销后该邀请码将立即失效，确定继续？")) return;
    try { setStatus("invite-status", "正在撤销…"); await api(`/admin/invites/${encodeURIComponent(codeHash)}/revoke`, { method: "POST" }); setStatus("invite-status", "邀请码已撤销。"); await loadBase(); } catch (error) { setStatus("invite-status", error.message, true); }
  }

  async function updateAccountStatus(accountId, status) {
    if (!confirm(status === "suspended" ? "暂停后该账户将无法继续使用 BotGo，确定继续？" : "恢复该账户？")) return;
    try { setStatus("account-status", "正在更新账户…"); await api(`/admin/accounts/${encodeURIComponent(accountId)}/status`, jsonOptions("POST", { status })); setStatus("account-status", "账户状态已更新。"); await loadAccounts(state.accountPage); } catch (error) { setStatus("account-status", error.message, true); }
  }

  async function grantPro(accountId) {
    if (!confirm("按当前套餐为该账户开通或续期 Pro，并重置本期额度？")) return;
    try { setStatus("account-status", "正在开通 Pro…"); const result = await api(`/admin/accounts/${encodeURIComponent(accountId)}/subscription`, jsonOptions("POST", { plan: "pro" })); setStatus("account-status", `Pro 已开通，到期时间：${new Date(result.expiresAt).toLocaleString("zh-CN")}`); await loadAccounts(state.accountPage); } catch (error) { setStatus("account-status", error.message, true); }
  }

  async function loadBase() {
    const [overview, invites] = await Promise.all([api("/admin/overview"), api("/admin/invites")]);
    state.admin = overview.admin; state.overview = overview.overview; state.invites = invites.invites || [];
    $("#metric-accounts").textContent = overview.overview.accounts; $("#metric-active").textContent = overview.overview.active; $("#metric-pending").textContent = overview.overview.pendingVerifications;
    $("#admin-identity").textContent = overview.admin.email; $("#admin-gate").hidden = true; $("#admin-dashboard").hidden = false;
    renderInvites(); await loadAccounts(); window.dispatchEvent(new CustomEvent("botgo:admin-ready"));
  }

  async function boot() {
    try { await loadBase(); } catch (error) { $("#admin-status").textContent = error.message; $("#admin-gate").hidden = false; $("#admin-dashboard").hidden = true; }
  }

  window.BotGoAdmin = { api, jsonOptions, setStatus, formatTime, cell, table, escapeHtml };
  $$('dialog [value="cancel"]').forEach((button) => { button.type = "button"; button.addEventListener("click", () => button.closest("dialog").close()); });
  applyTheme(localStorage.getItem("botgo-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  $("#admin-theme-toggle").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("#admin-menu-toggle").addEventListener("click", () => { const open = document.body.classList.toggle("nav-open"); $("#admin-menu-toggle").setAttribute("aria-expanded", String(open)); });
  window.addEventListener("hashchange", renderNavigation); renderNavigation();
  $("#admin-refresh").addEventListener("click", () => boot());
  $("#account-filter").addEventListener("submit", (event) => { event.preventDefault(); loadAccounts(1).catch((error) => setStatus("account-status", error.message, true)); });
  $("#open-invite-dialog").addEventListener("click", () => $("#invite-dialog").showModal());
  $("#admin-invite-form").addEventListener("submit", async (event) => { event.preventDefault(); try { const result = await api("/admin/invites", jsonOptions("POST", Object.fromEntries(new FormData(event.currentTarget)))); $("#invite-dialog").close(); setStatus("invite-status", "邀请码已生成，请立即保存："); $("#invite-status").insertAdjacentHTML("beforeend", `<code class="invite-code">${result.invite.code}</code>`); event.currentTarget.reset(); $("#invite-credits").value = "20"; await loadBase(); } catch (error) { setStatus("invite-status", error.message, true); } });
  const isLocalPreview = ["localhost", "127.0.0.1"].includes(location.hostname); $("#admin-test-login").hidden = !isLocalPreview;
  $("#admin-test-login").addEventListener("click", async () => { try { await api("/auth/dev-test-login", { method: "POST" }); await boot(); } catch (error) { $("#admin-status").textContent = error.message; } });
  boot();
})();
