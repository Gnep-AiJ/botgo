(() => {
  "use strict";
  const { api, jsonOptions, setStatus, formatTime, cell, table, escapeHtml } = window.BotGoAdmin;
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const labels = { desktop_codex: "客户端", desktop_opencode: "客户端" };
  const state = { upstreams: [], routes: [], agentRoutes: [], models: [], releases: [], routingBusy: false, selectedRoute: null };

  const statusPill = (status) => {
    const value = status === "ok" ? ["success", "已验证"] : status === "review" ? ["warning", "待核对"] : status === "failed" ? ["danger", "失败"] : ["neutral", "未验证"];
    return `<span class="status-pill ${value[0]}">${value[1]}</span>`;
  };

  const memberReady = (member, agent) => member.enabled !== false && member.enabled !== 0 && (agent ? member.verified_at && (!member.blocked_reason || member.blocked_reason === "usage_review") : member.probeStatus === "ok");

  function routeEntries() {
    const standard = state.routes.filter(route=>route.channel!=='web_chat').map((route) => ({ key: `${route.channel}:${route.modelId}`, routeType: route.channel, modelId: route.modelId, name: route.modelId, protocol: "Responses", enabled: true, members: route.members || [], agent: false }));
    const agent = state.agentRoutes.map((route) => ({ key: `desktop_opencode:${route.model_id}`, routeType: "desktop_opencode", modelId: route.model_id, name: route.name || route.model_id, protocol: route.protocol === "chat" ? "Chat Completions" : "Responses", enabled: Boolean(route.enabled), members: route.members || [], agent: true }));
    return [...standard, ...agent].map((route) => {
      const readyMembers = route.members.filter((member) => memberReady(member, route.agent));
      const active = route.members.reduce((sum, member) => sum + Number(member.activeRequests ?? member.active_requests ?? 0), 0);
      const capacity = route.members.reduce((sum, member) => sum + Number(member.maxConcurrency ?? member.max_concurrency ?? 5), 0);
      const blocked = route.members.filter((member) => member.blocked_reason).length;
      const catalogModel=route.agent?state.models.find(model=>model.id===route.modelId):state.models.find(model=>model.upstream_id===route.modelId);
      const stateName = !route.enabled||!catalogModel?.enabled ? "disabled" : readyMembers.length ? "ready" : blocked ? "blocked" : "unavailable";
      return { ...route, readyMembers, active, capacity, blocked, stateName };
    });
  }

  function routeState(entry) {
    if (entry.stateName === "ready") return '<span class="status-pill success">正常</span>';
    if (entry.stateName === "disabled") return '<span class="status-pill neutral">未启用</span>';
    if (entry.stateName === "blocked") return '<span class="status-pill danger">用量待核对</span>';
    return '<span class="status-pill warning">未就绪</span>';
  }

  function registryRows(entries) {
    if (!entries.length) return '<p class="empty-state">尚未配置路由。</p>';
    return `<div class="route-registry-head" aria-hidden="true"><span>渠道与模型</span><span>协议</span><span>成员</span><span>负载</span><span>状态</span><span></span></div>${entries.map((entry) => `<button class="route-registry-row" type="button" data-route-key="${escapeHtml(entry.key)}"><span class="route-identity"><strong>${escapeHtml(labels[entry.routeType])}</strong><small>${escapeHtml(entry.name)}</small></span><span>${escapeHtml(entry.protocol)}</span><span><strong>${entry.readyMembers.length} / ${entry.members.length}</strong><small>可用 / 全部</small></span><span><strong>${entry.active} / ${entry.capacity}</strong><small>请求 / 容量</small></span><span>${routeState(entry)}</span><span class="route-chevron" aria-hidden="true">›</span></button>`).join("")}`;
  }

  function renderRouteDetail(entry) {
    const members = entry.members.map((member, index) => {
      const profileId = member.profileId || member.profile_id;
      const profile = state.upstreams.find((item) => item.id === profileId) || {};
      const ready = memberReady(member, entry.agent);
      const active = Number(member.activeRequests ?? member.active_requests ?? profile.activeRequests ?? 0);
      const capacity = Number(member.maxConcurrency ?? member.max_concurrency ?? profile.maxConcurrency ?? 5);
      const reason = member.blocked_reason === "usage_review" ? "用量缺失，等待核对" : member.blocked_reason === "abandoned" ? "请求异常中断" : member.blocked_reason || (ready ? "探测已通过" : "尚未通过探测");
      return `<li class="route-chain-member"><span class="chain-index">${index + 1}</span><div><strong>${escapeHtml(profile.name || member.profileName || member.profile_name || profileId)}</strong><small>${escapeHtml(profile.baseUrl || member.baseUrl || member.base_url || "端点未知")} · ${escapeHtml(profile.keyHint || "Key 未知")}</small><small>${active}/${capacity} 并发 · ${escapeHtml(reason)}</small></div>${ready ? '<span class="status-pill success">可用</span>' : '<span class="status-pill danger">阻断</span>'}</li>`;
    }).join("") || '<li class="empty-state">此路由还没有上游成员。</li>';
    $("#route-detail-eyebrow").textContent = `${labels[entry.routeType]} · ${entry.protocol}`;
    $("#route-detail-title").textContent = entry.name;
    $("#route-detail-content").innerHTML = `<div class="route-chain-summary"><div><span>渠道</span><strong>${escapeHtml(labels[entry.routeType])}</strong></div><b aria-hidden="true">→</b><div><span>模型</span><strong>${escapeHtml(entry.modelId)}</strong></div><b aria-hidden="true">→</b><div><span>路由池</span><strong>${entry.readyMembers.length}/${entry.members.length} 可用</strong></div></div><div class="route-detail-meta"><span>${routeState(entry)}</span><span>${entry.active}/${entry.capacity} 并发占用</span></div><ol class="route-chain-list">${members}</ol>`;
  }

  function openRouteDetail(key) {
    const entry = routeEntries().find((item) => item.key === key);
    if (!entry) return;
    state.selectedRoute = entry;
    renderRouteDetail(entry);
    $("#route-detail-dialog").showModal();
  }

  function bindRouteRows() {
    $$('[data-route-key]').forEach((button) => button.addEventListener("click", () => openRouteDetail(button.dataset.routeKey)));
  }

  function renderRoutes() {
    const entries = routeEntries();
    const ready = entries.filter((entry) => entry.stateName === "ready").length;
    const capacity = state.upstreams.reduce((sum, profile) => sum + Number(profile.maxConcurrency || 5), 0);
    $("#route-grid").innerHTML = registryRows(entries);
    $("#route-overview").innerHTML = `<div class="overview-route-list">${entries.slice(0, 5).map((entry) => `<button type="button" data-route-key="${escapeHtml(entry.key)}"><span><strong>${escapeHtml(labels[entry.routeType])}</strong><small>${escapeHtml(entry.name)}</small></span>${routeState(entry)}</button>`).join("") || '<p class="empty-state">尚未配置路由。</p>'}</div>`;
    $("#route-total").textContent = String(entries.length);
    $("#route-ready").textContent = String(ready);
    $("#route-attention").textContent = String(entries.length - ready);
    $("#route-capacity").textContent = String(capacity);
    $("#metric-routes").textContent = `${ready}/${entries.length}`;
    bindRouteRows();
  }

  function renderUpstreams() {
    const rows = state.upstreams.filter(profile=>!profile.retired).map((profile) => `<tr>${cell("上游", `<strong>${escapeHtml(profile.name)}</strong><span class="table-sub">${escapeHtml(profile.baseUrl)}</span>`)}${cell("API Key", escapeHtml(profile.keyHint))}${cell("总并发", `${Number(profile.activeRequests || 0)} / ${Number(profile.maxConcurrency || 5)}`)}${cell("关联模型", (profile.dependencies||[]).length?[...new Set(profile.dependencies.map(item=>item.modelId))].map(modelId=>`<button type="button" class="table-button" data-open-model="${escapeHtml(modelId)}">${escapeHtml(modelId)}</button>`).join(" "):"未使用")}${cell("操作", `<div class="table-actions"><button class="table-button" type="button" data-edit-upstream="${escapeHtml(profile.id)}">编辑</button><button class="table-button danger" type="button" data-delete-upstream="${escapeHtml(profile.id)}">${(profile.dependencies||[]).length?'停用并清空':'删除'}</button></div>`)}</tr>`);
    $("#upstream-list").innerHTML = table(["上游", "API Key", "总并发", "关联模型", "操作"], rows, "尚未添加上游连接");
    $$('[data-edit-upstream]').forEach((button) => button.addEventListener("click", () => openUpstreamDialog(button.dataset.editUpstream)));
    $$('[data-delete-upstream]').forEach((button) => button.addEventListener("click", () => deleteUpstream(button.dataset.deleteUpstream)));
    $$('[data-open-model]').forEach(button=>button.addEventListener('click',()=>{window.BotGoAdminPendingModel=button.dataset.openModel;location.hash='#metering';}));
  }

  async function loadRouting() {
    const [profiles, routes, agents, metering] = await Promise.all([api("/admin/upstreams"), api("/admin/routes"), api("/admin/opencode"), api("/admin/metering")]);
    state.upstreams = profiles.upstreams || [];
    state.routes = routes.routes || [];
    state.agentRoutes = agents.routes || [];
    state.models = (metering.models || []).filter((model) => !model.archived);
    renderRoutes(); renderUpstreams();
    const failures = state.upstreams.filter((profile) => profile.lastTestStatus === "failed");
    $("#overview-alerts").innerHTML = failures.length ? failures.map((profile) => `<div class="alert-item"><span>${escapeHtml(profile.name)} 最近探测失败</span><a class="text-link" href="#upstreams">检查</a></div>`).join("") : '<p class="empty-state">暂无需要处理的上游异常。</p>';
  }

  function openUpstreamDialog(id = "") {
    const form = $("#upstream-form"), profile = state.upstreams.find((item) => item.id === id);
    form.reset(); form.elements.id.value = profile?.id || ""; form.elements.name.value = profile?.name || ""; form.elements.baseUrl.value = profile?.baseUrl || ""; form.elements.maxConcurrency.value = profile?.maxConcurrency || 5; form.elements.apiKey.required = !profile;
    $("#upstream-dialog-title").textContent = profile ? "编辑上游" : "添加上游"; $("#upstream-dialog").showModal();
  }

  function currentRouteFormState() {
    const form = $("#route-form"), routeType = form.elements.routeType.value, agent = routeType === "desktop_opencode";
    const modelId = agent ? form.elements.agentModel.value : form.elements.modelId.value.trim();
    const route = agent ? state.agentRoutes.find((item) => item.model_id === modelId) : state.routes.find((item) => item.channel === routeType && item.modelId === modelId);
    return { form, routeType, agent, modelId, route };
  }

  function renderRouteMembers() {
    const { agent, route } = currentRouteFormState();
    const selected = new Set((route?.members || []).filter((member) => member.enabled !== false && member.enabled !== 0).map((member) => member.profileId || member.profile_id));
    $("#route-member-list").innerHTML = state.upstreams.map((profile) => {
      const member = (route?.members || []).find((item) => (item.profileId || item.profile_id) === profile.id);
      const probe = agent ? (member?.blocked_reason === "usage_review" ? "review" : member?.blocked_reason ? "failed" : member?.verified_at ? "ok" : null) : member?.probeStatus;
      return `<div class="route-member-option"><label><input type="checkbox" name="members" value="${escapeHtml(profile.id)}" ${selected.has(profile.id) ? "checked" : ""}><span><strong>${escapeHtml(profile.name)} · ${escapeHtml(profile.keyHint)}</strong><small>${escapeHtml(profile.baseUrl)} · ${profile.activeRequests}/${profile.maxConcurrency} 并发</small></span></label><label>上游模型 ID<input data-member-model="${escapeHtml(profile.id)}" value="${escapeHtml(member?.upstreamModelId||member?.upstream_model_id||currentRouteFormState().modelId)}" maxlength="128"></label>${statusPill(probe)}<button class="table-button" type="button" data-probe-member="${escapeHtml(profile.id)}">探测</button></div>`;
    }).join("") || '<p class="empty-state">请先添加上游端点。</p>';
    $$('[data-probe-member]').forEach((button) => button.addEventListener("click", () => probeRouteMember(button.dataset.probeMember)));
  }

  function syncRouteForm() {
    const { form, agent, route } = currentRouteFormState();
    form.querySelector("[data-standard-model]").hidden = agent; form.querySelector("[data-agent-model]").hidden = !agent; form.querySelector("[data-agent-options]").hidden = !agent;
    if (agent && route) { form.elements.protocol.value = route.protocol || "responses"; form.elements.enabled.checked = Boolean(route.enabled); } else if (agent) form.elements.enabled.checked = false;
    renderRouteMembers();
  }

  function openRouteDialog(routeType = "desktop_opencode", modelId = "") {
    if (!state.upstreams.length) return setStatus("upstream-status", "请先添加一个上游端点。", true);
    const form = $("#route-form"); form.reset(); form.elements.routeType.value = routeType;
    form.elements.agentModel.innerHTML = state.models.map((model) => `<option value="${escapeHtml(model.id)}">${escapeHtml(model.name)}</option>`).join("");
    if (routeType === "desktop_opencode" && !state.models.length) return setStatus("upstream-status", "请先在模型目录中添加模型。", true);
    if (routeType === "desktop_opencode") form.elements.agentModel.value = modelId || state.agentRoutes[0]?.model_id || state.models[0]?.id || "";
    else form.elements.modelId.value = modelId || state.routes.find((route) => route.channel === routeType)?.modelId || "gpt-5.6-sol";
    $("#route-test-summary").textContent = "选择成员后可逐个探测；保存会一次性更新整个路由池。"; syncRouteForm(); $("#route-dialog").showModal();
  }

  async function probeRouteMember(profileId) {
    if (state.routingBusy) return;
    const { agent, routeType, modelId, route } = currentRouteFormState();
    if (!modelId) return $("#route-test-summary").textContent = "请先填写模型 ID。";
    if (agent && !route?.members?.some((member) => member.profile_id === profileId)) return $("#route-test-summary").textContent = "Agent 成员需先以未启用状态保存，再执行探测。";
    state.routingBusy = true; const button = $(`[data-probe-member="${CSS.escape(profileId)}"]`); if (button) button.disabled = true; $("#route-test-summary").textContent = "正在执行真实流式能力探测…";
    try {
      if (agent) await api(`/admin/opencode/models/${encodeURIComponent(modelId)}/probe`, jsonOptions("POST", { profileId,protocol:currentRouteFormState().form.elements.protocol.value }));
      else await api(`/admin/upstreams/${profileId}/test`, jsonOptions("POST", { channel: routeType, modelId:$(`[data-member-model="${CSS.escape(profileId)}"]`)?.value||modelId,protocol:routeType==='web_chat'?'chat':'responses' }));
      $("#route-test-summary").textContent = "探测通过，可以应用或启用该成员。"; await loadRouting();
    } catch (error) { $("#route-test-summary").textContent = error.message; }
    finally { state.routingBusy = false; if (button) button.disabled = false; }
  }

  async function saveRoute(event) {
    event.preventDefault(); if (state.routingBusy) return;
    const { form, agent, routeType, modelId, route } = currentRouteFormState();
    const members = [...form.querySelectorAll('input[name="members"]:checked')].map((input, index) => ({ profileId: input.value,upstreamModelId:form.querySelector(`[data-member-model="${CSS.escape(input.value)}"]`)?.value||modelId,protocol:agent?form.elements.protocol.value:routeType==='web_chat'?'chat':'responses', enabled: true, priority: (index + 1) * 10 }));
    if (!modelId || !members.length) return $("#route-test-summary").textContent = "请填写模型并至少选择一个上游成员。";
    state.routingBusy = true; const submit = form.querySelector('[type="submit"]'); submit.disabled = true; $("#route-test-summary").textContent = "正在原子应用路由池…";
    try {
      if (agent) { let costPrice = null; try { costPrice = route?.cost_price_json ? JSON.parse(route.cost_price_json) : null; } catch {} await api(`/admin/opencode/models/${encodeURIComponent(modelId)}`, jsonOptions("PUT", { members, protocol: form.elements.protocol.value, enabled: form.elements.enabled.checked, costPrice })); }
      else await api(`/admin/routes/${routeType}`, jsonOptions("PUT", { modelId, members }));
      await loadRouting(); $("#route-dialog").close(); setStatus("upstream-status", `${labels[routeType]} 路由池已更新。`);
    } catch (error) { $("#route-test-summary").textContent = error.message; }
    finally { state.routingBusy = false; submit.disabled = false; }
  }

  async function deleteUpstream(id) {
    const profile = state.upstreams.find((item) => item.id === id);
    if (!profile) return;
    const dependencies=[...new Set((profile.dependencies||[]).map(item=>item.modelId))];
    if(dependencies.length){
      if(!confirm(`停用并解除上游“${profile.name}”的全部绑定？\n影响模型：${dependencies.join('、')}\n没有其他上游的模型将下架。历史记录保留。`))return;
      try{await api(`/admin/upstreams/${id}/retire`,{method:'POST'});await loadRouting();setStatus('upstream-status','上游已停用并从模型绑定中移除。');}catch(error){setStatus('upstream-status',error.message,true);}return;
    }
    if(!confirm(`删除上游“${profile.name}”？如有历史记录则会退役归档。`))return;
    try{await api(`/admin/upstreams/${id}`,{method:'DELETE'});await loadRouting();setStatus('upstream-status','上游已删除。');}
    catch(error){if(error.status===409){try{await api(`/admin/upstreams/${id}/retire`,{method:'POST'});await loadRouting();setStatus('upstream-status','有历史记录，上游已退役归档。');}catch(retireError){setStatus('upstream-status',retireError.message,true);}}else setStatus('upstream-status',error.message,true);}
  }

  async function loadPlan() {
    const [data, orders] = await Promise.all([api("/admin/billing/plan"), api("/admin/billing/orders")]);
    $("#payment-state").textContent = data.paymentAvailable ? "可用" : "未开放"; $("#payment-state").className = `status-pill ${data.paymentAvailable ? "success" : "warning"}`;
    const states = { pending: "待支付", paid: "已入账", closed: "已关闭", failed: "失败" };
    const rows = (orders.orders || []).map((order) => `<tr>${cell("订单", escapeHtml(order.outTradeNo || order.out_trade_no || order.id))}${cell("账户", escapeHtml(order.email))}${cell("金额（元）", (Number(order.amountCents ?? order.amount_cents) / 100).toFixed(2))}${cell("状态", states[order.status] || escapeHtml(order.status))}${cell("时间", formatTime(order.createdAt || order.created_at))}</tr>`);
    $("#order-list").innerHTML = table(["订单", "账户", "金额（元）", "状态", "时间"], rows, "暂无充值订单");
  }

  async function loadReleases() {
    const data = await api("/admin/desktop/releases"); state.releases = data.releases || [];
    const rows = state.releases.map((release) => `<tr>${cell("版本", `<strong>${escapeHtml(release.version)}</strong><span class="table-sub">${escapeHtml(release.platform)}</span>`)}${cell("状态", `<span class="status-pill ${release.status === "published" ? "success" : release.status === "draft" ? "warning" : "neutral"}">${release.status === "published" ? "当前版本" : release.status === "draft" ? "草稿" : "已退役"}</span>`)}${cell("文件", escapeHtml(release.file_name))}${cell("发布时间", formatTime(release.published_at))}${cell("操作", release.status === "draft" ? `<div class="table-actions"><button class="table-button" type="button" data-publish-release="${release.id}">发布</button><button class="table-button danger" data-delete-release="${release.id}">删除</button></div>` : release.status==='published'?`<button class="table-button danger" type="button" data-stop-release="${release.id}">停止分发</button>`:"—")}</tr>`);
    $("#release-list").innerHTML = table(["版本", "状态", "文件", "发布时间", "操作"], rows, "暂无发布记录");
    $$('[data-delete-release]').forEach((button) => button.addEventListener("click", () => deleteRelease(button.dataset.deleteRelease))); $$('[data-publish-release]').forEach((button) => button.addEventListener("click", () => publishRelease(button.dataset.publishRelease)));
    $$('[data-stop-release]').forEach(button=>button.addEventListener('click',()=>stopRelease(button.dataset.stopRelease)));
  }

  async function deleteRelease(id) { if (!confirm("删除此版本草稿？")) return; try { await api(`/admin/desktop/releases/${id}`, { method: "DELETE" }); await loadReleases(); } catch (error) { setStatus("release-status", error.message, true); } }
  async function publishRelease(id) { const release = state.releases.find((item) => item.id === id); if (!release || !confirm(`发布 ${release.version}？当前已发布版本将标记为已退役。`)) return; try { setStatus("release-status", "正在验证 R2 对象并发布…"); await api(`/admin/desktop/releases/${id}/publish`, { method: "POST" }); setStatus("release-status", "版本已发布。"); await loadReleases(); } catch (error) { setStatus("release-status", error.message, true); } }
  async function stopRelease(id){const release=state.releases.find(item=>item.id===id);if(!release||!confirm(`停止分发 ${release.version}？客户端下载入口将暂无版本。`))return;try{await api(`/admin/desktop/releases/${id}/stop`,{method:'POST'});await loadReleases();setStatus('release-status','已停止分发。');}catch(error){setStatus('release-status',error.message,true);}}

  $("#open-upstream-dialog").addEventListener("click", () => openUpstreamDialog()); $("#open-route-dialog").addEventListener("click", () => openRouteDialog()); $("#open-release-dialog").addEventListener("click", () => $("#release-dialog").showModal());
  $$('[data-close-route-detail]').forEach((button) => button.addEventListener("click", () => $("#route-detail-dialog").close()));
  $("#configure-selected-route").addEventListener("click", () => {
    const selected = state.selectedRoute;
    $("#route-detail-dialog").close();
    if (selected) openRouteDialog(selected.routeType, selected.modelId);
  });
  $("#upstream-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget, submit = form.querySelector('[type="submit"]'); if (submit.disabled) return;
    const data = Object.fromEntries(new FormData(form)); const id = data.id; delete data.id; data.maxConcurrency = Number(data.maxConcurrency); if (!data.apiKey) delete data.apiKey; submit.disabled = true;
    try { await api(id ? `/admin/upstreams/${id}` : "/admin/upstreams", jsonOptions(id ? "PUT" : "POST", data)); $("#upstream-dialog").close(); setStatus("upstream-status", "上游已保存；端点或 Key 变化会自动要求重新探测。"); await loadRouting(); } catch (error) { setStatus("upstream-status", error.message, true); } finally { submit.disabled = false; }
  });
  $("#route-form").addEventListener("submit", saveRoute); $("#route-form").elements.routeType.addEventListener("change", syncRouteForm); $("#route-form").elements.agentModel.addEventListener("change", syncRouteForm); $("#route-form").elements.modelId.addEventListener("change", syncRouteForm);
  $("#release-form").addEventListener("submit", async (event) => { event.preventDefault(); try { await api("/admin/desktop/releases", jsonOptions("POST", Object.fromEntries(new FormData(event.currentTarget)))); $("#release-dialog").close(); setStatus("release-status", "版本草稿已登记。"); await loadReleases(); } catch (error) { setStatus("release-status", error.message, true); } });
  $("#refresh-orders").addEventListener("click", () => loadPlan().catch((error) => setStatus("billing-status", error.message, true)));

  function reportLoadError(target, error) { const node = $(target); if (node) node.innerHTML = `<p class="action-status" role="status">${escapeHtml(error.message || "加载失败，请刷新重试。")}</p>`; }
  window.addEventListener("botgo:admin-ready", () => Promise.allSettled([
    loadRouting().catch((error) => { reportLoadError("#route-grid", error); reportLoadError("#route-overview", error); reportLoadError("#overview-alerts", error); $("#metric-routes").textContent = "—"; }),
    loadPlan().catch((error) => setStatus("billing-status", error.message, true)), loadReleases().catch((error) => reportLoadError("#release-list", error))
  ]));
})();
