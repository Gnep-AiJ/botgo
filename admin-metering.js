(() => {
  const {api,jsonOptions,escapeHtml:esc}=window.BotGoAdmin;
  const root=document.querySelector('[data-admin-view="metering"]');
  let models=[],profiles=[],routes=[],imageModels=[],defaultImageModel=null,busy=false,failedBindings=[];
  const savedModel=id=>models.find(item=>item.id===id);
  async function load(){
    if(busy||document.getElementById('admin-dashboard').hidden)return;
    busy=true;
    try{const [metering,upstreams,agent,images]=await Promise.all([api('/admin/metering'),api('/admin/upstreams'),api('/admin/opencode'),api('/admin/model-services/images')]);models=metering.models||[];profiles=upstreams.upstreams||[];routes=agent.routes||[];imageModels=images.images||[];defaultImageModel=images.defaultModelId||null;render();}
    catch(error){root.innerHTML=`<section class="panel"><h2>模型服务加载失败</h2><p role="alert">${esc(error.message)}</p><button class="button secondary" data-retry>重试</button></section>`;root.querySelector('[data-retry]').onclick=()=>{busy=false;load();};}
    finally{busy=false;}
  }
  function render(){
    const ids=models.map(item=>item.id);
    root.innerHTML=`<div class="view-actions"><div><h2>模型服务</h2><p class="view-lead">从上游选择 GPT、Claude 或 Grok 模型，测试通过后自动加入客户端</p></div><div><button class="button secondary" data-sync-prices>同步官网价格</button><button class="button secondary" data-test-all>测试全部</button><button class="button primary" data-import>更新模型/价格</button></div></div><section class="panel"><div class="data-table"><table class="service-table"><thead><tr><th>模型</th><th>官方价 输入 / 输出</th><th>状态</th><th>可用上游</th><th>操作</th></tr></thead><tbody>${ids.map(id=>{const model=savedModel(id),route=routes.find(item=>item.model_id===id),price=model?.price;const count=(route?.members||[]).filter(item=>item.enabled&&item.verified_at&&!item.retired_at).length;return `<tr><td data-label="模型"><div class="cell-stack"><strong>${esc(model?.name||id)}</strong><small>${esc(id)}</small></div></td><td data-label="官方价"><div class="cell-stack">${price?`<span>$${Number(price.input).toFixed(2)} / $${Number(price.output).toFixed(2)}</span>${price.date?`<small>${esc(price.date)}${price.parser==='workers_ai'?' · Workers AI':''}</small>`:''}`:'—'}</div></td><td data-label="状态"><span class="status-pill ${model?.enabled&&route?.enabled?'success':'neutral'}">${model?.enabled&&route?.enabled?'已发布':'未上架'}</span></td><td data-label="可用上游">${count}</td><td data-label="操作"><button type="button" class="table-button danger" data-delete-model="${esc(id)}">删除</button></td></tr>`}).join('')}</tbody></table>${ids.length?'':'<p class="empty-state">暂无模型。先添加上游，再从上游选择模型。</p>'}</div></section><section class="panel"><div class="view-actions"><div><h3>生图模型</h3></div></div><div class="data-table"><table class="service-table"><thead><tr><th>模型</th><th>计价型号</th><th>上游</th><th>状态</th><th>操作</th></tr></thead><tbody>${imageModels.map(item=>`<tr><td data-label="模型"><div class="cell-stack"><strong>${esc(item.name)}${item.model_id===defaultImageModel?' <span class="status-pill success">默认</span>':''}</strong><small>${esc(item.model_id)}</small></div></td><td data-label="计价型号">${esc(item.billing_model_id)}</td><td data-label="上游">${esc(item.upstream_name||item.profile_id)}</td><td data-label="状态"><span class="status-pill ${item.enabled&&item.verified_at?'success':'neutral'}">${item.enabled&&item.verified_at?'已验证':'未验证'}</span></td><td data-label="操作"><span class="table-actions">${item.model_id!==defaultImageModel&&item.enabled&&item.verified_at?`<button type="button" class="table-button" data-default-image="${esc(item.model_id)}">设为默认</button>`:''}<button type="button" class="table-button danger" data-delete-image="${esc(item.model_id)}">删除</button></span></td></tr>`).join('')}</tbody></table>${imageModels.length?'':'<p class="empty-state">暂无生图模型。可从上游模型列表中勾选并添加。</p>'}</div></section><p class="action-status" data-status role="status"></p><dialog class="model-editor service-drawer" data-drawer></dialog>`;
    root.querySelector('[data-sync-prices]').onclick=syncActivePrices;
    root.querySelector('[data-import]').onclick=importDialog;
    root.querySelector('[data-test-all]').onclick=()=>testAll();
    root.querySelectorAll('[data-delete-model]').forEach(button=>button.onclick=()=>deleteModel(button.dataset.deleteModel));
    root.querySelectorAll('[data-delete-image]').forEach(button=>button.onclick=()=>deleteImageModel(button.dataset.deleteImage));
    root.querySelectorAll('[data-default-image]').forEach(button=>button.onclick=()=>setDefaultImageModel(button.dataset.defaultImage));
  }
  async function syncActivePrices(){
    const button=root.querySelector('[data-sync-prices]'),status=root.querySelector('[data-status]');
    if(button)button.disabled=true;status.textContent='正在核对已发布模型的最新官方价格…';
    try{
      const result=await api('/admin/model-services/sync-active',{method:'POST'});
      await load();
      root.querySelector('[data-status]').textContent=`已核对 ${result.checked||0} 个模型，更新价格 ${result.updated||0} 个。`;
    }catch(error){status.textContent=`价格同步失败：${error.message}`;}
    finally{if(button)button.disabled=false;}
  }
  async function setDefaultImageModel(id){const status=root.querySelector('[data-status]');status.textContent='正在设置默认生图模型…';try{await api('/admin/model-services/images/default',jsonOptions('PUT',{modelId:id}));await load();root.querySelector('[data-status]').textContent='默认生图模型已更新。';}catch(error){status.textContent=`设置失败：${error.message}`;}}
  async function deleteImageModel(id){if(!confirm(`删除生图模型“${id}”？`))return;try{await api(`/admin/model-services/images/${encodeURIComponent(id)}`,{method:'DELETE'});await load();root.querySelector('[data-status]').textContent='生图模型已删除。';}catch(error){root.querySelector('[data-status]').textContent=`删除失败：${error.message}`;}}
  async function deleteModel(id){
    const model=savedModel(id);if(!confirm(`删除“${model?.name||id}”？\n\n将解除当前上游绑定，历史调用与账务记录仍保留。`))return;
    const status=root.querySelector('[data-status]');status.textContent='正在删除…';
    try{await api(`/admin/model-services/${encodeURIComponent(id)}`,{method:'DELETE'});await load();root.querySelector('[data-status]').textContent='模型已删除。';}
    catch(error){status.textContent=`删除失败：${error.message}`;}
  }
  const pickerCache=new Map(),groupNames={all:'全部',gpt:'GPT 对话',claude:'Claude',grok:'Grok',image:'图片'};
  const groupOf=item=>item.imageEligible||item.reference?.imagePrice?'image':item.id.startsWith('claude-')?'claude':item.id.startsWith('grok-')?'grok':'gpt';
  const cacheKey=id=>'botgo-admin-model-list-v2:'+id;
  const profileStamp=profile=>JSON.stringify([profile?.baseUrl,profile?.updatedAt]);
  function readPickerCache(profile){
    try{
      const saved=pickerCache.get(profile.id)||JSON.parse(localStorage.getItem(cacheKey(profile.id))||'null');
      if(saved?.stamp!==profileStamp(profile)||!Number.isFinite(saved.listedAt)||Date.now()-saved.listedAt>10*60*1000||!Array.isArray(saved.models)||saved.models.length>1000||saved.models.some(item=>typeof item?.id!=='string'||!/^(gpt-|claude-|grok-)[A-Za-z0-9._-]{1,123}$/.test(item.id)))return null;
      return saved;
    }catch{return null;}
  }
  function savePickerCache(profile,items,listedAt){
    const saved={stamp:profileStamp(profile),models:items,listedAt};pickerCache.set(profile.id,saved);
    try{localStorage.setItem(cacheKey(profile.id),JSON.stringify(saved));}catch{/* The current page still retains its list if browser storage is unavailable. */}
  }
  function rememberPickerSelection(dialog){
    try{localStorage.setItem('botgo-admin-model-selection',JSON.stringify({profileId:dialog.querySelector('[data-profile]').value,group:dialog.querySelector('[data-model-group]').value}));}catch{}
  }
  function rememberModelChecks(dialog){
    const state=dialog._picker;
    for(const input of dialog.querySelectorAll('[data-available] input[type="checkbox"]')){if(input.checked)state.selected.add(input.value);else state.selected.delete(input.value);}
    for(const select of dialog.querySelectorAll('[data-billing-for]'))state.billing.set(select.dataset.billingFor,select.value);
  }
  function visibleModels(dialog){const group=dialog.querySelector('[data-model-group]').value;return dialog._picker.items.filter(item=>group==='all'||groupOf(item)===group);}
  function renderAvailable(dialog){
    const target=dialog.querySelector('[data-available]'),items=visibleModels(dialog),state=dialog._picker;
    if(!dialog.querySelector('[data-profile]').value){target.textContent='先选择上游连接和模型分组，再更新。';return;}
    target.innerHTML=items.length?'<div class="model-choice-list">'+items.map(item=>{
      const image=item.reference?.imagePrice,supported=Boolean(item.official||item.imageEligible),isNew=supported&&!savedModel(item.id)&&!imageModels.some(model=>model.model_id===item.id);
      const note=item.official?esc(item.official.provider)+' · Standard $'+Number(item.official.price?.input)+' / $'+Number(item.official.price?.output):image?'官方生图价 · 文本输入 $'+Number(image.textInput)+' · 图像输入 / 输出 $'+Number(image.imageInput)+' / $'+Number(image.imageOutput):item.imageEligible?'上游生图别名，需选择对应的官方计价型号':'未能取得该精确型号的完整官方价格，暂不能添加';
      const status=item.verification?.status,label=status==='verified'?' · 官网核对成功':status==='retained'?' · 本次核对失败，保留已核价':status==='pinned'?' · 内置已核价':status==='cached'?' · 已保存核价':'';
      const billing=officialImageChoices(item),choice=state.billing.get(item.id)|| (image?item.id:'');
      return '<div class="model-choice-row check-field '+(supported?'':'is-disabled')+'"><label><input type="checkbox" value="'+esc(item.id)+'" data-kind="'+(item.imageEligible?'image':'text')+'" '+(supported?'':'disabled')+' '+(state.selected.has(item.id)&&supported?'checked':'')+'><span><strong>'+esc(item.id)+(isNew?' <span class="status-pill success">可新增</span>':'')+'</strong><small>'+note+label+'</small></span></label>'+(item.imageEligible?'<select data-billing-for="'+esc(item.id)+'" aria-label="'+esc(item.id)+' 生图计价型号">'+(image?'':'<option value="">选择官方计价型号</option>')+billing.map(model=>'<option value="'+esc(model.id)+'" '+(choice===model.id?'selected':'')+'>按 '+esc(model.name)+' 计价</option>').join('')+'</select>':'')+'</div>';
    }).join('')+'</div><p class="form-help">当前分组 '+items.length+' 个型号；<span data-selected-count>已选 '+state.selected.size+' 个模型</span>。单价单位为美元 / 百万 Token。新模型仍需通过测试后加入客户端。</p>':'<p class="empty-state">当前分组暂无型号，可点击“更新当前分组”读取最新列表。</p>';
    target.onchange=()=>{rememberModelChecks(dialog);const count=target.querySelector('[data-selected-count]');if(count)count.textContent='已选 '+state.selected.size+' 个模型';};
  }
  function importDialog(){
    const dialog=root.querySelector('[data-drawer]');let last={};try{last=JSON.parse(localStorage.getItem('botgo-admin-model-selection')||'{}')||{};}catch{}
    const active=profiles.filter(profile=>!profile.retired);
    dialog._picker={items:[],selected:new Set(),billing:new Map()};dialog._request=0;
    dialog.innerHTML=`<div class="dialog-shell service-form"><div class="dialog-heading"><h2>更新模型与官方价格</h2><button type="button" class="icon-control" data-close aria-label="关闭">×</button></div><p class="form-help">先选上游和分组。已有列表直接读取；点击更新时才核对当前分组的官方价格。</p><div class="field-row"><label>上游连接<select data-profile><option value="">选择上游连接</option>${active.map(profile=>`<option value="${esc(profile.id)}">${esc(profile.name)} · ${esc(profile.baseUrl)}</option>`).join('')}</select></label><label>模型分组<select data-model-group>${Object.entries(groupNames).map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select></label></div><details><summary>高级设置</summary><label>接口协议<select data-protocol><option value="responses">Responses</option><option value="chat">Chat Completions</option></select></label></details><div data-available class="data-table"></div><p class="action-status" data-progress role="status"></p><div class="form-actions"><button type="button" class="button secondary" data-retry disabled>更新当前分组</button><button type="button" class="button primary" data-add disabled>测试并添加</button></div></div>`;
    const profile=dialog.querySelector('[data-profile]'),group=dialog.querySelector('[data-model-group]');
    if(active.some(item=>item.id===last.profileId))profile.value=last.profileId;if(Object.hasOwn(groupNames,last.group))group.value=last.group;
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();
    profile.onchange=()=>{dialog._picker={items:[],selected:new Set(),billing:new Map()};rememberPickerSelection(dialog);loadAvailable(dialog);};
    group.onchange=()=>{rememberModelChecks(dialog);rememberPickerSelection(dialog);renderAvailable(dialog);if(!dialog.dataset.loading)dialog.querySelector('[data-progress]').textContent='显示 '+groupNames[group.value]+' 分组的已有列表；需要最新价格时点击更新当前分组。';};
    dialog.querySelector('[data-retry]').onclick=()=>loadAvailable(dialog,true);dialog.querySelector('[data-add]').onclick=()=>importSelected(dialog);
    dialog.addEventListener('close',()=>{dialog._request++;load();},{once:true});dialog.showModal();loadAvailable(dialog);
  }
  async function loadAvailable(dialog,refresh=false){
    const requestId=++dialog._request,profileControl=dialog.querySelector('[data-profile]'),groupControl=dialog.querySelector('[data-model-group]'),profile=profiles.find(item=>item.id===profileControl.value),target=dialog.querySelector('[data-available]'),progress=dialog.querySelector('[data-progress]');
    const current=()=>dialog.open&&dialog._request===requestId;
    const add=dialog.querySelector('[data-add]'),retry=dialog.querySelector('[data-retry]');
    if(!profile){delete dialog.dataset.loading;target.removeAttribute('aria-busy');renderAvailable(dialog);progress.textContent='';add.disabled=true;retry.disabled=true;return;}
    rememberModelChecks(dialog);rememberPickerSelection(dialog);
    const cached=readPickerCache(profile);
    if(!refresh&&cached){
      delete dialog.dataset.loading;target.removeAttribute('aria-busy');dialog._picker.items=cached.models;renderAvailable(dialog);
      progress.textContent='显示已保存列表（'+new Date(cached.listedAt).toLocaleString('zh-CN')+'），未重新核价。需要新型号时更新当前分组。';add.disabled=false;retry.disabled=false;
      try{
        const prices=await api('/admin/model-services/prices');if(!current())return;
        for(const updated of prices.models||[]){const item=dialog._picker.items.find(item=>item.id===updated.id);if(item)Object.assign(item,updated);}
        savePickerCache(profile,dialog._picker.items,cached.listedAt);rememberModelChecks(dialog);renderAvailable(dialog);
        progress.textContent='显示已保存列表，已读取后台最新核价。未重新抓取官网；新型号请更新当前分组。';
      }catch{/* Saved list remains usable; explicit import still verifies price on the server. */}
      return;
    }
    const controls=refresh?[profileControl,groupControl,add,retry]:[add,retry];controls.forEach(control=>control.disabled=true);dialog.dataset.loading='1';target.setAttribute('aria-busy','true');
    if(!dialog._picker.items.length)target.textContent='正在读取上游模型列表…';progress.textContent=refresh?'正在读取最新上游列表…':'正在读取模型列表和已保存价格，不重新核价…';
    try{
      const result=await api('/admin/model-services/available?prices=cached&profileId='+encodeURIComponent(profile.id));if(!current())return;
      const items=result.models||[],listedAt=Date.now();dialog._picker.items=items;savePickerCache(profile,items,listedAt);renderAvailable(dialog);
      const updating=visibleModels(dialog);let checked=0,verified=0,retained=0,unverified=0,pinned=0;
      if(refresh)for(let index=0;index<updating.length;index+=5){
        progress.textContent='正在核对 '+groupNames[groupControl.value]+' 官方价格 '+Math.min(index+5,updating.length)+'/'+updating.length+'…';
        const batch=await api('/admin/model-services/refresh-prices',jsonOptions('POST',{modelIds:updating.slice(index,index+5).map(item=>item.id)}));if(!current())return;
        for(const updated of batch.models||[]){const item=items.find(item=>item.id===updated.id);if(item)Object.assign(item,updated);checked++;if(updated.verification.status==='verified')verified++;else if(updated.verification.status==='retained')retained++;else if(updated.verification.status==='pinned')pinned++;else unverified++;}
        savePickerCache(profile,items,listedAt);renderAvailable(dialog);
      }
      progress.textContent=refresh?'当前分组更新完成：官网核对 '+verified+'/'+checked+'；保留旧价 '+retained+'；内置已核价 '+pinned+'；未核价 '+unverified+'。':'已读取列表与保存价格，未重新核价。可先选择分组，再按需更新。';
    }catch(error){if(current()){renderAvailable(dialog);progress.textContent='更新未完成：'+error.message+'。已保存列表仍可使用，可重试当前分组。';}}
    finally{if(current()){delete dialog.dataset.loading;target.removeAttribute('aria-busy');controls.forEach(control=>control.disabled=false);}}
  }

  async function importSelected(dialog){
    rememberModelChecks(dialog);
    const selected=dialog._picker.items.filter(item=>dialog._picker.selected.has(item.id)&&(item.official||item.imageEligible)).map(item=>({id:item.id,kind:item.imageEligible?'image':'text',billingModelId:dialog._picker.billing.get(item.id)|| (item.reference?.imagePrice?item.id:'')})),profileId=dialog.querySelector('[data-profile]').value,protocol=dialog.querySelector('[data-protocol]').value,progress=dialog.querySelector('[data-progress]'),button=dialog.querySelector('[data-add]');if(!selected.length){progress.textContent='先勾选模型。';return;}
    if(selected.some(item=>item.kind==='image'&&!item.billingModelId)){progress.textContent='请先为勾选的生图别名选择官方计价型号。';return;}
    button.disabled=true;let passed=0;const failed=[];for(let index=0;index<selected.length;index++){const item=selected[index];progress.textContent=`正在测试 ${index+1}/${selected.length}：${item.id}`;try{const image=item.kind==='image',result=await api(image?'/admin/model-services/image-import':'/admin/model-services/import',jsonOptions('POST',image?{profileId,modelId:item.id,billingModelId:item.billingModelId}:{profileId,modelId:item.id,protocol}));if(result.ok)passed++;else failed.push(`${item.id}：${result.code||'IMPORT_FAILED'}${result.upstreamStatus?' HTTP '+result.upstreamStatus:''}`);}catch(error){failed.push(`${item.id}：${error.message}`);}}
    button.disabled=false;const summary=`已添加 ${passed}/${selected.length}${failed.length?'；失败：'+failed.join('；'):''}`;progress.textContent=summary;if(passed){dialog.close();await load();root.querySelector('[data-status]').textContent=summary;}
  }
  function officialImageChoices(item){return Array.isArray(item.billingModels)?item.billingModels:[];}
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
