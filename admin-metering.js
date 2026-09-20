(() => {
  const {api,jsonOptions,escapeHtml:esc}=window.BotGoAdmin;
  const root=document.querySelector('[data-admin-view="metering"]');
  let models=[],drafts=[],profiles=[],routes=[],busy=false,failedBindings=[];
  const savedModel=id=>models.find(item=>item.id===id);
  const savedDraft=id=>drafts.find(item=>item.modelId===id);
  async function load(){
    if(busy||document.getElementById('admin-dashboard').hidden)return;
    busy=true;
    try{const [metering,staged,upstreams,agent]=await Promise.all([api('/admin/metering'),api('/admin/model-services'),api('/admin/upstreams'),api('/admin/opencode')]);models=metering.models||[];drafts=staged.drafts||[];profiles=upstreams.upstreams||[];routes=agent.routes||[];render();}
    catch(error){root.innerHTML=`<section class="panel"><h2>模型服务加载失败</h2><p role="alert">${esc(error.message)}</p><button class="button secondary" data-retry>重试</button></section>`;root.querySelector('[data-retry]').onclick=()=>{busy=false;load();};}
    finally{busy=false;}
  }
  function render(){
    const ids=[...new Set([...models.map(item=>item.id),...drafts.map(item=>item.modelId)])];
    root.innerHTML=`<div class="view-actions"><div><h2>模型服务</h2><p class="view-lead">选择上游中的 GPT 模型，测试通过后自动加入客户端</p></div><div><button class="button secondary" data-test-all>测试全部</button><button class="button primary" data-import>从上游添加</button></div></div><section class="panel"><div class="data-table"><table class="service-table"><thead><tr><th>模型</th><th>官方价 输入 / 输出</th><th>状态</th><th>可用上游</th><th>高级</th></tr></thead><tbody>${ids.map(id=>{const model=savedModel(id),draft=savedDraft(id),route=routes.find(item=>item.model_id===id),price=model?.price;const count=(route?.members||[]).filter(item=>item.enabled&&item.verified_at&&!item.retired_at).length;return `<tr><td><strong>${esc(model?.name||draft?.config.name||id)}</strong><small>${esc(id)}</small></td><td>${price?`$${Number(price.input).toFixed(2)} / $${Number(price.output).toFixed(2)}`:'—'}</td><td><span class="status-pill ${model?.enabled&&route?.enabled?'success':'neutral'}">${model?.enabled&&route?.enabled?'已发布':'未上架'}</span>${draft?'<small>旧草稿待处理</small>':''}</td><td>${count}</td><td>${model?`<button type="button" class="table-button" data-multiplier="${esc(id)}">倍率</button>`:''}</td></tr>`}).join('')}</tbody></table>${ids.length?'':'<p class="empty-state">暂无模型。先添加上游，再从上游选择模型。</p>'}</div></section><p class="action-status" data-status role="status"></p><dialog class="model-editor service-drawer" data-drawer></dialog>`;
    root.querySelector('[data-import]').onclick=importDialog;
    root.querySelector('[data-test-all]').onclick=()=>testAll();
    root.querySelectorAll('[data-multiplier]').forEach(button=>button.onclick=()=>multiplierDialog(button.dataset.multiplier));
  }
  function multiplierDialog(id){
    const model=savedModel(id),dialog=root.querySelector('[data-drawer]');
    dialog.innerHTML=`<form class="dialog-shell" data-multiplier-form><div class="dialog-heading"><h2>${esc(model.name)} · 倍率</h2><button type="button" class="icon-control" data-close aria-label="关闭">×</button></div><label>模型倍率<input name="multiplier" type="number" min="0.000001" max="100" step="0.000001" value="${model.multiplier_ppm==null?'':model.multiplier_ppm/1e6}" placeholder="留空继承全局倍率"></label><p class="form-help">留空继承全局倍率，不与全局倍率相乘。</p><p class="action-status" data-feedback role="status"></p><div class="form-actions"><button class="button primary" type="submit">保存</button></div></form>`;
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const value=dialog.querySelector('[name=multiplier]').value,ppm=value===''?null:Math.round(Number(value)*1e6),feedback=dialog.querySelector('[data-feedback]');try{await api(`/admin/model-services/${encodeURIComponent(id)}/multiplier`,jsonOptions('PUT',{multiplierPpm:ppm}));dialog.close();await load();root.querySelector('[data-status]').textContent='模型倍率已保存。';}catch(error){feedback.textContent=error.message;}};dialog.showModal();
  }
  function importDialog(){
    const dialog=root.querySelector('[data-drawer]');
    dialog.innerHTML=`<div class="dialog-shell service-form"><div class="dialog-heading"><h2>从上游添加模型</h2><button type="button" class="icon-control" data-close aria-label="关闭">×</button></div><label>上游连接<select data-profile>${profiles.filter(profile=>!profile.retired).map(profile=>`<option value="${esc(profile.id)}">${esc(profile.name)} · ${esc(profile.baseUrl)}</option>`).join('')}</select></label><details><summary>高级设置</summary><label>接口协议<select data-protocol><option value="responses">Responses</option><option value="chat">Chat Completions</option></select></label></details><div data-available class="data-table"><p class="empty-state">选择上游后读取模型列表</p></div><p class="action-status" data-progress role="status"></p><div class="form-actions"><button type="button" class="button secondary" data-retry>重新读取</button><button type="button" class="button primary" data-add>测试并添加</button></div></div>`;
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('[data-profile]').onchange=()=>loadAvailable(dialog);dialog.querySelector('[data-retry]').onclick=()=>loadAvailable(dialog);dialog.querySelector('[data-add]').onclick=()=>importSelected(dialog);dialog.showModal();loadAvailable(dialog);
  }
  async function loadAvailable(dialog){
    const profileId=dialog.querySelector('[data-profile]').value,target=dialog.querySelector('[data-available]');if(!profileId){target.textContent='请先添加上游连接。';return;}
    target.textContent='正在读取模型列表…';try{const result=await api(`/admin/model-services/available?profileId=${encodeURIComponent(profileId)}`);target.innerHTML=(result.models||[]).length?`<div class="model-choice-list">${result.models.map(item=>`<label class="check-field"><input type="checkbox" value="${esc(item.id)}" ${item.official?'':'disabled'}><span><strong>${esc(item.id)}</strong><small>${item.official?` · Standard $${item.official.price.input} / $${item.official.price.output}`:' · 无已核实官方价格'}</small></span></label>`).join('')}</div>`:'<p class="empty-state">上游未返回 GPT 模型。</p>';}
    catch(error){target.textContent=`读取失败：${error.message}`;}
  }
  async function importSelected(dialog){
    const ids=[...dialog.querySelectorAll('[data-available] input:checked')].map(input=>input.value),profileId=dialog.querySelector('[data-profile]').value,protocol=dialog.querySelector('[data-protocol]').value,progress=dialog.querySelector('[data-progress]'),button=dialog.querySelector('[data-add]');if(!ids.length){progress.textContent='先勾选模型。';return;}
    button.disabled=true;let passed=0;const failed=[];for(let index=0;index<ids.length;index++){progress.textContent=`正在测试 ${index+1}/${ids.length}：${ids[index]}`;try{const result=await api('/admin/model-services/import',jsonOptions('POST',{profileId,modelId:ids[index],protocol}));if(result.ok)passed++;else failed.push(`${ids[index]}：${result.code}${result.upstreamStatus?' HTTP '+result.upstreamStatus:''}${result.upstreamCode?' / '+result.upstreamCode:''}`);}catch(error){failed.push(`${ids[index]}：${error.message}`);}}
    button.disabled=false;const summary=`已添加 ${passed}/${ids.length}${failed.length?'；失败：'+failed.join('；'):''}`;progress.textContent=summary;if(passed){dialog.close();await load();root.querySelector('[data-status]').textContent=summary;}
  }
  async function testAll(retry=false){
    const bindings=retry?failedBindings:routes.flatMap(route=>(route.members||[]).filter(member=>member.enabled).map(member=>({modelId:route.model_id,profileId:member.profile_id}))),status=root.querySelector('[data-status]'),button=root.querySelector('[data-test-all]');if(!bindings.length){status.textContent='暂无可测试的模型绑定。';return;}
    button.disabled=true;const failures=[],next=[];for(let index=0;index<bindings.length;index++){const item=bindings[index];status.textContent=`测试中 ${index+1}/${bindings.length}：${item.modelId}`;try{const result=await api('/admin/model-services/probe-binding',jsonOptions('POST',item));if(!result.ok){next.push(item);failures.push(`${item.modelId}：${result.code}${result.upstreamStatus?' HTTP '+result.upstreamStatus:''}${result.upstreamCode?' / '+result.upstreamCode:''}`);}}catch(error){next.push(item);failures.push(`${item.modelId}：${error.message}`);}}
    failedBindings=next;button.disabled=false;button.textContent=next.length?'重试失败项':'测试全部';button.onclick=()=>testAll(next.length>0);status.textContent=failures.length?`失败 ${failures.length}/${bindings.length}：${failures.join('；')}`:`全部 ${bindings.length} 条绑定测试通过。`;
  }
  window.addEventListener('botgo:admin-view',event=>{if(event.detail.view==='metering')load();});
  window.addEventListener('botgo:admin-view',async event=>{
    if(event.detail.view!=='billing')return;
    const target=document.getElementById('call-ledger'),form=document.getElementById('global-metering-form'),status=document.getElementById('global-metering-status');
    try{const response=await api('/admin/metering');const records=(response.ledger||[]).filter(item=>item.channel==='desktop_opencode');
      form.elements.multiplier.value=Number(response.settings.multiplier_ppm)/1e6;
      form.elements.usdCny.value=Number(response.settings.usd_cny_ppm)/1e6;
      form.elements.fxAuto.checked=!!response.settings.fx_auto;
      form.elements.usdCny.readOnly=form.elements.fxAuto.checked;
      document.getElementById('fx-updated-at').textContent=`汇率更新时间：${response.settings.fx_updated_at||'尚未自动更新'} · ${response.settings.fx_source||'初始值'}`;
      form.elements.fxAuto.onchange=()=>{form.elements.usdCny.readOnly=form.elements.fxAuto.checked;};
      form.onsubmit=async submitEvent=>{submitEvent.preventDefault();if(!form.reportValidity())return;const multiplierPpm=Math.round(Number(form.elements.multiplier.value)*1e6),usdCnyPpm=Math.round(Number(form.elements.usdCny.value)*1e6),fxAuto=form.elements.fxAuto.checked,button=form.querySelector('button[type="submit"]');button.disabled=true;status.textContent='保存中…';try{await api('/admin/metering/settings',jsonOptions('PUT',{multiplierPpm,usdCnyPpm,fxAuto}));status.textContent='已保存。新请求将使用当前设置。';}catch(error){status.textContent=`保存失败：${error.message}`;}finally{button.disabled=false;}};
      target.innerHTML=records.length?`<table><thead><tr><th>时间</th><th>模型</th><th>状态</th><th>消费金额</th><th>错误 / 用量</th></tr></thead><tbody>${records.map(item=>`<tr><td>${esc(item.created_at)}</td><td>${esc(item.model)}</td><td>${esc(item.state)}</td><td>¥${(Number(item.charged_micros||0)/1e6).toFixed(6)}</td><td><details><summary>查看</summary><pre>${esc(item.usage_json||'待核对或无用量')}\n${esc(item.snapshot||'')}</pre>${item.state==='review'&&!item.reviewed_at?`<button type="button" class="table-button" data-review="${esc(item.id)}">确认核对</button>`:''}</details></td></tr>`).join('')}</tbody></table>`:'<p class="empty-state">暂无客户端调用记录</p>';
      target.querySelectorAll('[data-review]').forEach(button=>button.onclick=async()=>{const note=prompt('填写核对结果和处理说明');if(!note||note.trim().length<4)return;try{await api('/admin/metering/review',jsonOptions('POST',{id:button.dataset.review,note:note.trim()}));window.dispatchEvent(new CustomEvent('botgo:admin-view',{detail:{view:'billing'}}));}catch(error){alert(error.message);}});
    }catch(error){status.textContent=`计费设置加载失败：${error.message}`;target.innerHTML=`<p role="alert">${esc(error.message)}</p>`;}
  });
  new MutationObserver(()=>{if(!document.getElementById('admin-dashboard').hidden)load();}).observe(document.getElementById('admin-dashboard'),{attributes:true,attributeFilter:['hidden']});
})();
