(() => {
  "use strict";
  const titles = { overview: "概览", upstreams: "上游与路由", metering: "模型与计费", accounts: "用户", billing: "充值", releases: "版本" };
  const state = { admin: null, overview: null,  accountPage: 1 };
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
    $$('[data-admin-nav]').forEach((link) => {if(link.dataset.adminNav === view)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
    $("#admin-page-title").textContent = titles[view];
    document.body.classList.remove("nav-open");
    $("#admin-menu-toggle").setAttribute("aria-expanded", "false");
    window.dispatchEvent(new CustomEvent("botgo:admin-view", { detail: { view } }));
  }

  function table(headers, rows, emptyText) {
    if (!rows.length) return `<p class="empty-state">${emptyText}</p>`;
    return `<table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
  }

  async function loadAccounts(page = 1) {
    const form = $("#account-filter"); const params = new URLSearchParams({ page: String(page), query: form.elements.query.value, status: form.elements.status.value });
    const data = await api(`/admin/accounts?${params}`); state.accountPage = data.page;
    const rows = data.accounts.map(account=>`<tr>${cell("账户",escapeHtml(account.email))}${cell("状态",account.status==="active"?"正常":"已停用")}${cell("余额（元）",Number(account.credit_balance).toFixed(2))}${cell("注册时间",formatTime(account.created_at))}${cell("操作",`<div class="table-actions"><button class="table-button" data-grant-balance="${escapeHtml(account.id)}">赠送余额</button>${account.role==="admin"?"":`<button class="table-button" data-account-status="${escapeHtml(account.id)}" data-next-status="${account.status==="active"?"suspended":"active"}">${account.status==="active"?"停用":"恢复"}</button>`}</div>`)}</tr>`);
    $("#account-list").innerHTML=table(["账户","状态","余额（元）","注册时间","操作"],rows,"暂无用户");
    $("#account-pagination").innerHTML = `<button class="button secondary compact" type="button" data-account-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}>上一页</button><span class="button ghost compact">${data.page} / ${data.pages}</span><button class="button secondary compact" type="button" data-account-page="${data.page + 1}" ${data.page >= data.pages ? "disabled" : ""}>下一页</button>`;
    $$('[data-account-page]').forEach((button) => button.addEventListener("click", () => loadAccounts(Number(button.dataset.accountPage))));
    $$('[data-account-status]').forEach((button) => button.addEventListener("click", () => updateAccountStatus(button.dataset.accountStatus, button.dataset.nextStatus)));
    $$('[data-grant-balance]').forEach(button=>button.addEventListener("click",()=>openGrant(data.accounts.find(a=>a.id===button.dataset.grantBalance))));
  }

  async function updateAccountStatus(accountId, status) {
    if (!confirm(status === "suspended" ? "暂停后该账户将无法继续使用 BotGo，确定继续？" : "恢复该账户？")) return;
    try { setStatus("account-status", "正在更新账户…"); await api(`/admin/accounts/${encodeURIComponent(accountId)}/status`, jsonOptions("POST", { status })); setStatus("account-status", "账户状态已更新。"); await loadAccounts(state.accountPage); } catch (error) { setStatus("account-status", error.message, true); }
  }

  let pendingGrant=null;
  function openGrant(account){
    pendingGrant={id:crypto.randomUUID(),accountId:account.id};
    $("#grant-form").reset();$("#grant-account").textContent=account.email;setStatus("grant-status","");
    $("#grant-dialog").showModal();
  }

  async function loadBase() {
    const overview = await api("/admin/overview");
    state.admin = overview.admin; state.overview = overview.overview;
    $("#metric-accounts").textContent = overview.overview.accounts; $("#metric-active").textContent = overview.overview.active; $("#metric-pending").textContent = overview.overview.pendingVerifications;
    $("#admin-identity").textContent = overview.admin.email; $("#admin-gate").hidden = true; $("#admin-dashboard").hidden = false;
    await loadAccounts(); window.dispatchEvent(new CustomEvent("botgo:admin-ready"));
  }

  async function boot() {
    try { await loadBase(); } catch (error) { $("#admin-status").textContent = error.message; $("#admin-gate").hidden = false; $("#admin-dashboard").hidden = true; }
  }

  window.BotGoAdmin = { api, jsonOptions, setStatus, formatTime, cell, table, escapeHtml };
  $$('dialog [value="cancel"]').forEach((button) => { button.type = "button"; button.addEventListener("click", () => button.closest("dialog").close()); });
  applyTheme(localStorage.getItem("botgo-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  $("#admin-theme-toggle").addEventListener("click", () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark"));
  $("#admin-menu-toggle").addEventListener("click", () => { const open = document.body.classList.toggle("nav-open"); $("#admin-menu-toggle").setAttribute("aria-expanded", String(open)); });
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.body.classList.contains('nav-open')){document.body.classList.remove('nav-open');$('#admin-menu-toggle').setAttribute('aria-expanded','false');$('#admin-menu-toggle').focus();}});
  document.addEventListener('pointerdown',event=>{if(document.body.classList.contains('nav-open')&&!event.target.closest('#admin-sidebar,#admin-menu-toggle')){document.body.classList.remove('nav-open');$('#admin-menu-toggle').setAttribute('aria-expanded','false');}});
  window.addEventListener("hashchange", renderNavigation); renderNavigation();
  $("#admin-refresh").addEventListener("click", () => boot());
  $("#account-filter").addEventListener("submit", (event) => { event.preventDefault(); loadAccounts(1).catch((error) => setStatus("account-status", error.message, true)); });
  const isLocalPreview = ["localhost", "127.0.0.1"].includes(location.hostname); $("#admin-test-login").hidden = !isLocalPreview;
  $("#admin-test-login").addEventListener("click", async () => { try { await api("/auth/dev-test-login", { method: "POST" }); await boot(); } catch (error) { $("#admin-status").textContent = error.message; } });
  $("#grant-form").addEventListener("submit",async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]');if(button.disabled)return;
    const raw=form.elements.amount.value;
    if(!/^\d+(?:\.\d{1,2})?$/.test(raw)){setStatus("grant-status","金额最多两位小数。",true);return;}
    const amountCents=Math.round(Number(raw)*100),reason=form.elements.reason.value.trim();
    if(!pendingGrant.payload)pendingGrant.payload={id:pendingGrant.id,amountCents,reason};
    else if(pendingGrant.payload.amountCents!==amountCents||pendingGrant.payload.reason!==reason){setStatus("grant-status","请关闭窗口后重新填写，避免重复入账。",true);return;}
    button.disabled=true;setStatus("grant-status","正在入账…");
    try{await api(`/admin/accounts/${encodeURIComponent(pendingGrant.accountId)}/grants`,jsonOptions("POST",pendingGrant.payload));$("#grant-dialog").close();await loadAccounts(state.accountPage);setStatus("account-status","余额已赠送。");}
    catch(error){setStatus("grant-status",error.message,true);}finally{button.disabled=false;}
  });
  boot();
})();
