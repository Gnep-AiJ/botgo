(() => {
  const {api,jsonOptions,escapeHtml:esc}=window.BotGoAdmin;
  const root=document.querySelector('[data-admin-view="metering"]');
  let models=[],profiles=[],routes=[],busy=false,failedBindings=[];
  const savedModel=id=>models.find(item=>item.id===id);
  async function load(){
    if(busy||document.getElementById('admin-dashboard').hidden)return;
    busy=true;
    try{const [metering,upstreams,agent]=await Promise.all([api('/admin/metering'),api('/admin/upstreams'),api('/admin/opencode')]);models=metering.models||[];profiles=upstreams.upstreams||[];routes=agent.routes||[];render();}
    catch(error){root.innerHTML=`<section class="panel"><h2>模型服务加载失败</h2><p role="alert">${esc(error.message)}</p><button class="button secondary" data-retry>重试</button></section>`;root.querySelector('[data-retry]').onclick=()=>{busy=false;load();};}
    finally{busy=false;}
  }
  function render(){
    const ids=models.map(item=>item.id);
    root.innerHTML=`<div class="view-actions"><div><h2>模型服务</h2><p class="view-lead">从上游选择 GPT、Claude 或 Grok 模型，测试通过后自动加入客户端</p></div><div><button class="button secondary" data-test-all>测试全部</button><button class="button primary" data-import>从上游添加</button></div></div><section class="panel"><div class="data-table"><table class="service-table"><thead><tr><th>模型</th><th>官方价 输入 / 输出</th><th>状态</th><th>可用上游</th><th>操作</th></tr></thead><tbody>${ids.map(id=>{const model=savedModel(id),route=routes.find(item=>item.model_id===id),price=model?.price;const count=(route?.members||[]).filter(item=>item.enabled&&item.verified_at&&!item.retired_at).length;return `<tr><td><strong>${esc(model?.name||id)}</strong><small>${esc(id)}</small></td><td>${price?`$${Number(price.input).toFixed(2)} / $${Number(price.output).toFixed(2)}`:'—'}</td><td><span class="status-pill ${model?.enabled&&route?.enabled?'success':'neutral'}">${model?.enabled&&route?.enabled?'已发布':'未上架'}</span></td><td>${count}</td><td><button type="button" class="table-button danger" data-delete-model="${esc(id)}">删除</button></td></tr>`}).join('')}</tbody></table>${ids.length?'':'<p class="empty-state">暂无模型。先添加上游，再从上游选择模型。</p>'}</div></section><p class="action-status" data-status role="status"></p><dialog class="model-editor service-drawer" data-drawer></dialog>`;
    root.querySelector('[data-import]').onclick=importDialog;
    root.querySelector('[data-test-all]').onclick=()=>testAll();
    root.querySelectorAll('[data-delete-model]').forEach(button=>button.onclick=()=>deleteModel(button.dataset.deleteModel));
  }
  async function deleteModel(id){
    const model=savedModel(id);if(!confirm(`删除“${model?.name||id}”？\n\n将解除当前上游绑定，历史调用与账务记录仍保留。`))return;
    const status=root.querySelector('[data-status]');status.textContent='正在删除…';
    try{await api(`/admin/model-services/${encodeURIComponent(id)}`,{method:'DELETE'});await load();root.querySelector('[data-status]').textContent='模型已删除。';}
    catch(error){status.textContent=`删除失败：${error.message}`;}
  }
  function importDialog(){
    const dialog=root.querySelector('[data-drawer]');
    dialog.innerHTML=`<div class="dialog-shell service-form"><div class="dialog-heading"><h2>从上游添加模型</h2><button type="button" class="icon-control" data-close aria-label="关闭">×</button></div><label>上游连接<select data-profile>${profiles.filter(profile=>!profile.retired).map(profile=>`<option value="${esc(profile.id)}">${esc(profile.name)} · ${esc(profile.baseUrl)}</option>`).join('')}</select></label><details><summary>高级设置</summary><label>接口协议<select data-protocol><option value="responses">Responses</option><option value="chat">Chat Completions</option></select></label></details><div data-available class="data-table"><p class="empty-state">选择上游后读取模型列表</p></div><p class="action-status" data-progress role="status"></p><div class="form-actions"><button type="button" class="button secondary" data-retry>重新读取</button><button type="button" class="button primary" data-add>测试并添加</button></div></div>`;
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('[data-profile]').onchange=()=>loadAvailable(dialog);dialog.querySelector('[data-retry]').onclick=()=>loadAvailable(dialog);dialog.querySelector('[data-add]').onclick=()=>importSelected(dialog);dialog.showModal();loadAvailable(dialog);
  }
  async function loadAvailable(dialog){
    const profileId=dialog.querySelector('[data-profile]').value,target=dialog.querySelector('[data-available]');if(!profileId){target.textContent='请先添加上游连接。';return;}
    target.textContent='正在读取模型列表…';try{const result=await api(`/admin/model-services/available?profileId=${encodeURIComponent(profileId)}`);target.innerHTML=(result.models||[]).length?`<div class="model-choice-list">${result.models.map(item=>`<label class="model-choice-row check-field ${item.official?'':'is-disabled'}"><input type="checkbox" value="${esc(item.id)}" ${item.official?'':'disabled'}><span><strong>${esc(item.id)}</strong><small>${item.official?`${esc(item.official.provider)} · Standard $${item.official.price.input} / $${item.official.price.output}`:'无已核实官方价格'}</small></span></label>`).join('')}</div><p class="form-help">价格按官方 Standard 口径锁定，倍率统一使用全局设置。</p>`:'<p class="empty-state">上游未返回可识别的 GPT、Claude 或 Grok 模型。</p>';}
    catch(error){target.textContent=`读取失败：${error.message}`;}
  }
  async function importSelected(dialog){
    const selected=[...dialog.querySelectorAll('[data-available] input[type="checkbox"]:checked')].map(input=>input.value),profileId=dialog.querySelector('[data-profile]').value,protocol=dialog.querySelector('[data-protocol]').value,progress=dialog.querySelector('[data-progress]'),button=dialog.querySelector('[data-add]');if(!selected.length){progress.textContent='先勾选模型。';return;}
    button.disabled=true;let passed=0;const failed=[];for(let index=0;index<selected.length;index++){const id=selected[index];progress.textContent=`正在测试 ${index+1}/${selected.length}：${id}`;try{const result=await api('/admin/model-services/import',jsonOptions('POST',{profileId,modelId:id,protocol}));if(result.ok)passed++;else failed.push(`${id}：${result.code}${result.upstreamStatus?' HTTP '+result.upstreamStatus:''}${result.upstreamCode?' / '+result.upstreamCode:''}`);}catch(error){failed.push(`${id}：${error.message}`);}}
    button.disabled=false;const summary=`已添加 ${passed}/${selected.length}${failed.length?'；失败：'+failed.join('；'):''}`;progress.textContent=summary;if(passed){dialog.close();await load();root.querySelector('[data-status]').textContent=summary;}
  }
  async function testAll(retry=false){
    const bindings=retry?failedBindings:routes.flatMap(route=>(route.members||[]).filter(member=>member.enabled).map(member=>({modelId:route.model_id,profileId:member.profile_id}))),status=root.querySelector('[data-status]'),button=root.querySelector('[data-test-all]');if(!bindings.length){status.textContent='暂无可测试的模型绑定。';return;}
    button.disabled=true;const failures=[],next=[];for(let index=0;index<bindings.length;index++){const item=bindings[index];status.textContent=`测试中 ${index+1}/${bindings.length}：${item.modelId}`;try{const result=await api('/admin/model-services/probe-binding',jsonOptions('POST',item));if(!result.ok){next.push(item);failures.push(`${item.modelId}：${result.code}${result.upstreamStatus?' HTTP '+result.upstreamStatus:''}${result.upstreamCode?' / '+result.upstreamCode:''}`);}}catch(error){next.push(item);failures.push(`${item.modelId}：${error.message}`);}}
    failedBindings=next;button.disabled=false;button.textContent=next.length?'重试失败项':'测试全部';button.onclick=()=>testAll(next.length>0);status.textContent=failures.length?`失败 ${failures.length}/${bindings.length}：${failures.join('；')}`:`全部 ${bindings.length} 条绑定测试通过。`;
  }
  window.addEventListener('botgo:admin-view',event=>{if(event.detail.view==='metering')load();});
  window.addEventListener('botgo:admin-view',async event=>{
    if(event.detail.view!=='billing')return;
    const target=document.getElementById('call-ledger'),anomalyTarget=document.getElementById('anomaly-ledger'),form=document.getElementById('global-metering-form'),status=document.getElementById('global-metering-status');
    try{const [response,anomalyData]=await Promise.all([api('/admin/metering'),api('/admin/metering/anomalies')]);const records=(response.ledger||[]).filter(item=>item.channel==='desktop_opencode'),anomalies=anomalyData.anomalies||[];
      form.elements.multiplier.value=Number(response.settings.multiplier_ppm)/1e6;
      form.elements.usdCny.value=Number(response.settings.usd_cny_ppm)/1e6;
      form.elements.fxAuto.checked=!!response.settings.fx_auto;
      form.elements.usdCny.readOnly=form.elements.fxAuto.checked;
      document.getElementById('fx-updated-at').textContent=`汇率更新时间：${response.settings.fx_updated_at||'尚未自动更新'} · ${response.settings.fx_source||'初始值'}`;
      form.elements.fxAuto.onchange=()=>{form.elements.usdCny.readOnly=form.elements.fxAuto.checked;};
      form.onsubmit=async submitEvent=>{submitEvent.preventDefault();if(!form.reportValidity())return;const multiplierPpm=Math.round(Number(form.elements.multiplier.value)*1e6),usdCnyPpm=Math.round(Number(form.elements.usdCny.value)*1e6),fxAuto=form.elements.fxAuto.checked,button=form.querySelector('button[type="submit"]');button.disabled=true;status.textContent='保存中…';try{await api('/admin/metering/settings',jsonOptions('PUT',{multiplierPpm,usdCnyPpm,fxAuto}));status.textContent='已保存。新请求将使用当前设置。';}catch(error){status.textContent=`保存失败：${error.message}`;}finally{button.disabled=false;}};
      document.getElementById('anomaly-count').textContent=anomalies.length?`${anomalies.length} 条`:'无异常';
      anomalyTarget.innerHTML=anomalies.length?`<table><thead><tr><th>时间</th><th>账户</th><th>模型</th><th>原因</th><th>处理结果</th><th>扣费</th></tr></thead><tbody>${anomalies.map(item=>`<tr><td>${esc(item.created_at)}</td><td>${esc(item.account_id)}</td><td><strong>${esc(item.model)}</strong><small>${esc(item.channel)}</small></td><td>${esc(item.review_reason)}</td><td>${item.state==='refunded'?'已自动退款':esc(item.state)}</td><td>¥${(Number(item.charged_micros||0)/1e6).toFixed(6)}</td></tr>`).join('')}</tbody></table>`:'<p class="empty-state">暂无异常记录</p>';
      target.innerHTML=records.length?`<table><thead><tr><th>时间</th><th>模型</th><th>状态</th><th>消费金额</th><th>错误 / 用量</th></tr></thead><tbody>${records.map(item=>`<tr><td>${esc(item.created_at)}</td><td>${esc(item.model)}</td><td>${esc(item.state)}</td><td>¥${(Number(item.charged_micros||0)/1e6).toFixed(6)}</td><td><details><summary>查看</summary><pre>${esc(item.review_reason||item.usage_json||'无用量')}</pre></details></td></tr>`).join('')}</tbody></table>`:'<p class="empty-state">暂无客户端调用记录</p>';
    }catch(error){status.textContent=`计费设置加载失败：${error.message}`;target.innerHTML=`<p role="alert">${esc(error.message)}</p>`;}
  });
  new MutationObserver(()=>{if(!document.getElementById('admin-dashboard').hidden)load();}).observe(document.getElementById('admin-dashboard'),{attributes:true,attributeFilter:['hidden']});
})();
