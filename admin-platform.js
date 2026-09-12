(() => {
  "use strict";
  const { api, jsonOptions, setStatus, formatTime, cell, table, escapeHtml } = window.BotGoAdmin;
  const $ = (selector) => document.querySelector(selector); const $$ = (selector) => [...document.querySelectorAll(selector)];
  const labels = { web_chat: "网页对话", desktop_codex: "桌面 Codex" };
  const state = { upstreams: [], routes: [], releases: [], orderPage: 1 };
  const pill = (status) => `<span class="status-pill ${status === "ok" ? "success" : status === "failed" ? "danger" : "neutral"}">${status === "ok" ? "可用" : status === "failed" ? "失败" : "未测试"}</span>`;

  function renderRoutes() {
    const channels = ["web_chat", "desktop_codex"];
    const cards = channels.map((channel) => { const route = state.routes.find((item) => item.channel === channel); return `<article class="route-card"><div class="route-card-head"><div><p>${channel === "web_chat" ? "CHAT COMPLETIONS" : "RESPONSES"}</p><h2>${labels[channel]}</h2></div><span class="status-pill neutral">${route ? "已绑定" : "未绑定"}</span></div><dl><dt>当前上游</dt><dd>${escapeHtml(route?.profileName || "尚未绑定")}</dd><dt>内部模型</dt><dd>${escapeHtml(route?.modelId || "—")}</dd><dt>最近切换</dt><dd>${formatTime(route?.updatedAt)}</dd></dl><div class="route-card-actions"><button class="button primary compact" type="button" data-switch-route="${channel}">测试并切换</button>${route?.previous?.profileId ? `<button class="button secondary compact" type="button" data-rollback-route="${channel}">回滚</button>` : ""}</div></article>`; });
    $("#route-grid").innerHTML = cards.join(""); $("#route-overview").innerHTML = cards.join("");
    $("#metric-routes").textContent = `${state.routes.length}/2`;
    $$('[data-switch-route]').forEach((button) => button.addEventListener("click", () => openRouteDialog(button.dataset.switchRoute)));
    $$('[data-rollback-route]').forEach((button) => button.addEventListener("click", () => rollbackRoute(button.dataset.rollbackRoute)));
  }

  function renderUpstreams() {
    const rows = state.upstreams.map((profile) => { const latest = profile.probes?.[0]; const channels = profile.assignedChannels?.map((channel) => labels[channel]).join("、") || "未使用"; return `<tr>${cell("上游", `<strong>${escapeHtml(profile.name)}</strong><span class="table-sub">${escapeHtml(profile.baseUrl)}</span>`)}${cell("密钥", escapeHtml(profile.keyHint))}${cell("使用渠道", escapeHtml(channels))}${cell("能力", pill(latest?.status))}${cell("最近测试", formatTime(latest?.tested_at))}${cell("操作", `<div class="table-actions"><button class="table-button" type="button" data-edit-upstream="${escapeHtml(profile.id)}">编辑</button><button class="table-button danger" type="button" data-delete-upstream="${escapeHtml(profile.id)}">删除</button></div>`)}</tr>`; });
    $("#upstream-list").innerHTML = table(["上游", "密钥", "使用渠道", "能力", "最近测试", "操作"], rows, "尚未配置上游");
    $$('[data-edit-upstream]').forEach((button) => button.addEventListener("click", () => openUpstreamDialog(button.dataset.editUpstream)));
    $$('[data-delete-upstream]').forEach((button) => button.addEventListener("click", () => deleteUpstream(button.dataset.deleteUpstream)));
  }

  async function loadUpstreams() {
    const [profiles, routes] = await Promise.all([api("/admin/upstreams"), api("/admin/routes")]); state.upstreams = profiles.upstreams || []; state.routes = routes.routes || [];
    $("#import-fallback").hidden = !profiles.fallbackConfigured || state.upstreams.some((profile) => profile.name === "当前 Worker 上游"); renderRoutes(); renderUpstreams();
    const failures = state.upstreams.filter((profile) => profile.probes?.some((probe) => probe.status === "failed")); $("#overview-alerts").innerHTML = failures.length ? failures.map((profile) => `<div class="alert-item"><span>${escapeHtml(profile.name)} 最近能力测试失败</span><a class="text-link" href="#upstreams">检查</a></div>`).join("") : '<p class="empty-state">暂无需要处理的上游异常。</p>';
  }

  function openUpstreamDialog(id = "") {
    const form = $("#upstream-form"); const profile = state.upstreams.find((item) => item.id === id); form.reset(); form.elements.id.value = profile?.id || ""; form.elements.name.value = profile?.name || ""; form.elements.baseUrl.value = profile?.baseUrl || ""; form.elements.apiKey.required = !profile; $("#upstream-dialog-title").textContent = profile ? "编辑上游" : "添加上游"; $("#upstream-dialog").showModal();
  }

  function openRouteDialog(channel) {
    if (!state.upstreams.length) return setStatus("upstream-status", "请先添加或导入一个上游。", true);
    const form = $("#route-form"); const current = state.routes.find((route) => route.channel === channel); form.elements.channel.value = channel; form.elements.profileId.innerHTML = state.upstreams.map((profile) => `<option value="${escapeHtml(profile.id)}" ${profile.id === current?.profileId ? "selected" : ""}>${escapeHtml(profile.name)}</option>`).join(""); form.elements.modelId.value = current?.modelId || "gpt-5.6"; $("#route-test-summary").textContent = `将真实调用 ${labels[channel]} 对应接口；测试可能产生少量上游用量。通过后立即切换。`; $("#route-dialog").showModal();
  }

  async function rollbackRoute(channel) { if (!confirm(`将${labels[channel]}恢复到上一次路由？原路由必须有 10 分钟内的有效测试。`)) return; try { setStatus("upstream-status", "正在回滚路由…"); await api(`/admin/routes/${channel}/rollback`, { method: "POST" }); setStatus("upstream-status", "路由已回滚。"); await loadUpstreams(); } catch (error) { setStatus("upstream-status", error.message, true); } }
  async function deleteUpstream(id) { const profile = state.upstreams.find((item) => item.id === id); if (!profile || !confirm(`永久删除上游“${profile.name}”？正在使用的上游不能删除。`)) return; try { await api(`/admin/upstreams/${id}`, { method: "DELETE" }); await loadUpstreams(); } catch (error) { setStatus("upstream-status", error.message, true); } }

  async function loadPlan() {
    const [data,orders]=await Promise.all([api("/admin/billing/plan"),api("/admin/billing/orders")]);
    $("#payment-state").textContent=data.paymentAvailable?"可用":"未开放";
    $("#payment-state").className="status-pill "+(data.paymentAvailable?"success":"warning");
    const states={pending:"待支付",paid:"已入账",closed:"已关闭",failed:"失败"};
    $("#order-list").innerHTML=table(["订单","账户","金额（元）","状态","时间"],orders.orders.map(o=>`<tr>${cell("订单",escapeHtml(o.outTradeNo||o.out_trade_no||o.id))}${cell("账户",escapeHtml(o.email))}${cell("金额（元）",(Number(o.amountCents??o.amount_cents)/100).toFixed(2))}${cell("状态",states[o.status]||escapeHtml(o.status))}${cell("时间",formatTime(o.createdAt||o.created_at))}</tr>`),"暂无充值订单");
  }
  async function loadReleases() { const data = await api("/admin/desktop/releases"); state.releases = data.releases || []; const rows = state.releases.map((release) => `<tr>${cell("版本", `<strong>${escapeHtml(release.version)}</strong><span class="table-sub">${escapeHtml(release.platform)}</span>`)}${cell("状态", `<span class="status-pill ${release.status === "published" ? "success" : release.status === "draft" ? "warning" : "neutral"}">${release.status === "published" ? "当前版本" : release.status === "draft" ? "草稿" : "已退役"}</span>`)}${cell("文件", escapeHtml(release.file_name))}${cell("大小", `${(release.size_bytes / 1048576).toFixed(1)} MB`)}${cell("创建时间", formatTime(release.created_at))}${cell("操作", release.status === "draft" ? `<div class="table-actions"><button class="table-button" type="button" data-publish-release="${release.id}">发布</button><button class="table-button danger" data-delete-release="${release.id}">删除</button></div>` : "—")}</tr>`); $("#release-list").innerHTML = table(["版本", "状态", "文件", "大小", "创建时间", "操作"], rows, "暂无发布记录"); $$('[data-delete-release]').forEach(button=>button.addEventListener("click",()=>deleteRelease(button.dataset.deleteRelease))); $$('[data-publish-release]').forEach((button) => button.addEventListener("click", () => publishRelease(button.dataset.publishRelease))); }
  async function deleteRelease(id){if(!confirm("删除此版本草稿？"))return;try{await api(`/admin/desktop/releases/${id}`,{method:"DELETE"});await loadReleases();}catch(error){setStatus("release-status",error.message,true);}}
  async function publishRelease(id) { const release = state.releases.find((item) => item.id === id); if (!release || !confirm(`发布 ${release.version}？当前已发布版本将被标记为已退役。`)) return; try { setStatus("release-status", "正在验证 R2 对象并发布…"); await api(`/admin/desktop/releases/${id}/publish`, { method: "POST" }); setStatus("release-status", "版本已发布。"); await loadReleases(); } catch (error) { setStatus("release-status", error.message, true); } }

  $("#open-upstream-dialog").addEventListener("click", () => openUpstreamDialog()); $("#open-release-dialog").addEventListener("click", () => $("#release-dialog").showModal());
  $("#import-fallback").addEventListener("click", async () => { if (!confirm("将当前 Worker 中的上游地址和密钥加密导入管理后台？")) return; try { await api("/admin/upstreams/import-fallback", { method: "POST" }); setStatus("upstream-status", "当前配置已导入，请完成两项能力测试。"); await loadUpstreams(); } catch (error) { setStatus("upstream-status", error.message, true); } });
  $("#upstream-form").addEventListener("submit", async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const id = data.id; delete data.id; if (!data.apiKey) delete data.apiKey; try { await api(id ? `/admin/upstreams/${id}` : "/admin/upstreams", jsonOptions(id ? "PUT" : "POST", data)); $("#upstream-dialog").close(); setStatus("upstream-status", "上游已保存，切换前必须重新测试。"); await loadUpstreams(); } catch (error) { setStatus("upstream-status", error.message, true); } });
  $("#route-form").addEventListener("submit", async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); const submit = event.currentTarget.querySelector('[type="submit"]'); submit.disabled = true; $("#route-test-summary").textContent = "正在测试模型列表和对应能力接口…"; try { const result = await api(`/admin/upstreams/${data.profileId}/test`, jsonOptions("POST", { channel: data.channel, modelId: data.modelId })); $("#route-test-summary").textContent = `测试通过：HTTP ${result.capability.status}，${result.capability.latencyMs} ms。正在切换…`; await api(`/admin/routes/${data.channel}`, jsonOptions("PUT", { profileId: data.profileId, modelId: data.modelId })); $("#route-dialog").close(); setStatus("upstream-status", `${labels[data.channel]}已切换。`); await loadUpstreams(); } catch (error) { $("#route-test-summary").textContent = error.message; } finally { submit.disabled = false; } });
  $("#release-form").addEventListener("submit", async (event) => { event.preventDefault(); try { await api("/admin/desktop/releases", jsonOptions("POST", Object.fromEntries(new FormData(event.currentTarget)))); $("#release-dialog").close(); setStatus("release-status", "版本草稿已登记。"); await loadReleases(); } catch (error) { setStatus("release-status", error.message, true); } });
  $("#refresh-orders").addEventListener("click",()=>loadPlan().catch(error=>setStatus("billing-status",error.message,true)));
  function reportLoadError(target,error){const node=$(target);if(!node)return;node.replaceChildren();const p=document.createElement('p');p.className='action-status';p.setAttribute('role','status');p.textContent=error.message||'加载失败，请刷新重试。';node.append(p);}
  window.addEventListener("botgo:admin-ready", () => Promise.allSettled([
    loadUpstreams().catch(error=>{reportLoadError('#route-grid',error);reportLoadError('#route-overview',error);reportLoadError('#overview-alerts',error);$('#metric-routes').textContent='—';}),
    loadPlan().catch(error=>setStatus('billing-status',error.message,true)),
    loadReleases().catch(error=>reportLoadError('#release-list',error))
  ]));
})();
