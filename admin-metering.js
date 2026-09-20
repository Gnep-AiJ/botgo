(() => {
  const {api,jsonOptions,escapeHtml:esc}=window.BotGoAdmin;
  const root=document.querySelector('[data-admin-view="metering"]');
  let data=null,upstreams=[],routes=[],agentRoutes=[],loading=false,saving=false;
  const input=(label,name,value,type='number')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(String(value))}" ${type==='number'?'min="0" step="any"':''} required></label>`;
  async function load(){
    if(loading||saving||document.getElementById('admin-dashboard').hidden)return;
    loading=true;root.setAttribute('aria-busy','true');root.querySelectorAll('button').forEach(button=>button.disabled=true);
    try{const [metering,profiles,webRoutes,nativeRoutes]=await Promise.all([api('/admin/metering'),api('/admin/upstreams'),api('/admin/routes'),api('/admin/opencode')]);data=metering;upstreams=profiles.upstreams||[];routes=webRoutes.routes||[];agentRoutes=nativeRoutes.routes||[];if(!data.settings||!Array.isArray(data.models)||!Array.isArray(data.ledger))throw Error('计费数据不完整。');render();}
    catch(error){root.innerHTML='<section class="panel"><h2>暂时无法加载</h2><p class="action-status" role="status">'+esc(error.message)+'</p><button class="button secondary" data-reload>重新加载</button></section>';root.querySelector('[data-reload]').onclick=load;}
    finally{loading=false;root.removeAttribute('aria-busy');root.querySelectorAll('button').forEach(button=>button.disabled=false);}
  }
  function render(){root.innerHTML=`<div class="panel-heading"><h2>模型与用量计费</h2><button type="button" class="button secondary" data-seed>初始化模型目录</button></div><form data-settings class="settings-form"><div class="field-row">${input('计费倍率','multiplier',data.settings.multiplier_ppm/1e6)}${input('USD/CNY 计价汇率','usdCny',data.settings.usd_cny_ppm/1e6)}</div><label>默认模型<select name="defaultModel">${data.models.filter(m=>m.enabled).map(m=>`<option value="${esc(m.id)}" ${m.id===data.settings.default_model?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><button class="button primary">保存设置</button></form><div data-models>${data.models.map(m=>`<details><summary>${esc(m.name)} · ${m.enabled?'已启用':'未启用'}</summary><form data-model="${esc(m.id)}" class="settings-form">${input('上游模型标识','upstreamId',m.upstream_id,'text')}<label class="model-global-toggle"><input name="enabled" type="checkbox" ${m.enabled?'checked':''}><span><strong>目录中启用</strong><small>关闭后所有渠道均不可使用此模型。</small></span></label><div class="model-route-note"><span>渠道可用性与上游成员由“上游与路由”统一管理。</span><a href="#upstreams">管理路由</a></div><label>模型倍率（留空继承）<input type="number" min="0.000001" step="any" name="multiplier" value="${m.multiplier_ppm===null?'':m.multiplier_ppm/1e6}"></label><div class="field-row">${input('输入 USD / 百万 token','input',m.price.input)}${input('缓存读取','cached',m.price.cached)}${input('缓存写入','write',m.price.write)}${input('输出','output',m.price.output)}</div><div class="field-row">${input('长上下文阈值','longThreshold',m.price.longThreshold)}${input('长输入倍率','longInput',m.price.longInput)}${input('长输出倍率','longOutput',m.price.longOutput)}</div>${input('官方价格来源','source',m.price.source,'url')}${input('价格日期','date',m.price.date,'date')}<p>修改仅影响后续请求。</p><button class="button primary">保存</button></form></details>`).join('')}</div><h3>最近用量与核对记录</h3><div class="data-table"><table><thead><tr><th>时间</th><th>模型 / 渠道</th><th>状态</th><th>费用 / 实扣（元）</th><th>明细</th></tr></thead><tbody>${data.ledger.map(r=>`<tr><td>${esc(r.created_at)}</td><td>${esc(r.model)}<small>${esc(r.channel)}</small></td><td>${esc(r.state)}</td><td>${(r.cost_micros/1e6).toFixed(6)} / ${(r.charged_micros/1e6).toFixed(6)}</td><td><details><summary>查看</summary><pre>${esc(r.usage_json||'无可核验用量')}\n${esc(r.snapshot)}</pre></details></td></tr>`).join('')}</tbody></table></div><p data-meter-status role="status"></p>`;
    organizePanels();
    root.querySelector('[data-seed]').textContent='添加模型';root.querySelector('[data-seed]').onclick=openCreateModel;
    for(const record of data.ledger.filter(r=>r.state==='review'&&!r.reviewed_at)){
      const form=document.createElement('form');form.className='settings-form';
      const label=document.createElement('label');label.textContent=`核对 ${record.model} · ${record.id}`;
      const input=document.createElement('input');input.required=true;input.minLength=4;input.maxLength=500;input.placeholder='记录核对结果及处理说明';label.append(input);
      const button=document.createElement('button');button.type='submit';button.textContent='确认核对';
      form.append(label,button);form.onsubmit=e=>{e.preventDefault();save('/admin/metering/review','POST',{id:record.id,note:input.value});};form.classList.add('review-card');button.className='button secondary';
      root.querySelector(`[data-ledger-index="${data.ledger.indexOf(record)}"] details`).append(form);
    }
    root.querySelector('[data-settings]').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);save('/admin/metering/settings','PUT',{multiplierPpm:Math.round(Number(f.get('multiplier'))*1e6),usdCnyPpm:Math.round(Number(f.get('usdCny'))*1e6),defaultModel:f.get('defaultModel')});};
    root.querySelectorAll('[data-model]').forEach(form=>form.onsubmit=e=>{e.preventDefault();saveService(form);});
  }
  function organizePanels(){
    const heading=root.querySelector('.panel-heading'),settings=root.querySelector('[data-settings]'),models=root.querySelector('[data-models]'),ledger=root.querySelector('.data-table'),title=root.querySelector('h3'),status=root.querySelector('[data-meter-status]');
    status.className='meter-status';status.setAttribute('aria-live','polite');heading.querySelector('h2').textContent='全局设置';
    const seed=heading.querySelector('[data-seed]');seed.textContent='添加模型';settings.classList.add('meter-settings');
    const section=title=>{const node=document.createElement('section');node.className='panel';if(title){const h=document.createElement('h2');h.textContent=title;node.append(h);}return node;};
    const globalPanel=section();globalPanel.append(heading,settings);
    if(!data.models.some(model=>model.enabled)){const note=document.createElement('p');note.className='empty-state';note.textContent='暂无可用模型。请先添加上游和模型并完成探测。';settings.before(note);settings.querySelector('button').disabled=true;}
    const modelPanel=section();const modelHeading=document.createElement('div');modelHeading.className='panel-heading';modelHeading.innerHTML='<h2>模型服务</h2>';modelHeading.append(seed);models.className='model-list';modelPanel.append(modelHeading,models);if(!data.models.length){const empty=document.createElement('p');empty.className='empty-state';empty.textContent='暂无模型，点击“添加模型”创建草稿。';models.append(empty);}
    [...models.querySelectorAll(':scope > details')].forEach((detail,index)=>{detail.className='model-card';const model=data.models[index],summary=detail.querySelector('summary');const label=document.createElement('span');label.className='model-name';label.textContent=model.name;const channels=document.createElement('small');channels.textContent='模型标识 '+model.upstream_id;label.append(channels);const badge=document.createElement('span');badge.className='status-pill '+(model.enabled?'success':'neutral');badge.textContent=model.enabled?'目录启用':'目录停用';summary.replaceChildren(label,badge);
      const remove=document.createElement('button');remove.type='button';remove.className='table-button danger';remove.textContent='删除';
      remove.onclick=event=>{event.preventDefault();event.stopPropagation();if(confirm('删除此模型？历史计费记录会保留。'))save('/admin/metering/models/'+model.id,'DELETE',{});};
      summary.append(remove);
      const edit=document.createElement('button');edit.type='button';edit.className='table-button';edit.textContent='编辑';summary.append(edit);
      const form=detail.querySelector('form');appendServiceFields(form,model);
      const dialog=document.createElement('dialog');dialog.className='model-editor';const header=document.createElement('div');header.className='dialog-heading';
      const heading=document.createElement('h2');heading.textContent=model.name;const close=document.createElement('button');close.type='button';close.className='icon-control';close.textContent='×';close.setAttribute('aria-label','关闭');close.onclick=()=>dialog.close();header.append(heading,close);dialog.append(header,form);modelPanel.append(dialog);
      summary.onclick=event=>{event.preventDefault();if(!event.target.closest('.danger'))dialog.showModal();};});
    const ledgerPanel=section('最近用量');ledgerPanel.dataset.ledger='';ledgerPanel.append(ledger);title.remove();
    const labels=[...ledger.querySelectorAll('th')].map(th=>th.textContent);const states={reserved:'处理中',completed:'已结算',refunded:'已退回',review:'待核对'};
    ledger.querySelectorAll('tbody tr').forEach(row=>[...row.children].forEach((cell,i)=>{cell.dataset.label=labels[i];if(i===3)cell.classList.add('numeric');if(i===2){const state=cell.textContent;cell.textContent='';const badge=document.createElement('span');badge.className='status-pill '+(state==='review'?'warning':state==='completed'?'success':'neutral');badge.textContent=states[state]||state;cell.append(badge);}}));
    ledger.querySelectorAll('details').forEach(detail=>detail.classList.add('ledger-details'));
    const filters=document.createElement('div');filters.className='ledger-filters';
    filters.innerHTML='<label>查找<input type="search" placeholder="请求、账户或模型" data-query></label><label>状态<select data-state><option value="">全部</option><option value="review">待核对</option><option value="reserved">处理中</option><option value="completed">已结算</option><option value="refunded">已退回</option></select></label><label>渠道<select data-channel><option value="">全部</option><option value="desktop_opencode">客户端</option><option value="desktop_codex">旧客户端</option><option value="web_chat">网页</option></select></label><p role="status" data-count></p>';
    const rows=[...ledger.querySelectorAll('tbody tr')];
    rows.forEach((row,index)=>{
      row.dataset.ledgerIndex=index;
      const record=data.ledger[index],identity=document.createElement('p');identity.className='ledger-identity';
      identity.textContent=`请求 ${record.id} · 账户 ${record.account_id}`;
      row.querySelector('details').prepend(identity);
      const channel=row.children[1].querySelector('small');
      channel.textContent=({desktop_opencode:'客户端',desktop_codex:'旧客户端',web_chat:'网页'})[record.channel]||record.channel;
    });
    const filter=()=>{
      const query=filters.querySelector('[data-query]').value.trim().toLowerCase(),state=filters.querySelector('[data-state]').value,channel=filters.querySelector('[data-channel]').value;
      let count=0;
      rows.forEach((row,index)=>{const r=data.ledger[index];row.hidden=Boolean((state&&r.state!==state)||(channel&&r.channel!==channel)||(query&&!`${r.id} ${r.account_id} ${r.model}`.toLowerCase().includes(query)));if(!row.hidden)count++;});
      filters.querySelector('[data-count]').textContent=`${count} / ${rows.length} 条`;
    };
    filters.addEventListener('input',filter);filter();ledgerPanel.insertBefore(filters,ledger);
    ledger.querySelectorAll('tbody tr').forEach((row,index)=>{const estimate=data.ledger[index]?.upstream_cost_estimate_micros;if(estimate!==null&&estimate!==undefined){const note=document.createElement('small');note.textContent='上游估算 ¥'+(estimate/1e6).toFixed(6);row.children[3].append(note);}});
    if(!data.ledger.length){const empty=document.createElement('p');empty.className='empty-state';empty.textContent='暂无请求记录';ledger.replaceChildren(empty);}
    const toolbar=document.createElement('div');toolbar.className='view-actions';toolbar.innerHTML='<p class="view-lead">点击一个模型，集中设置价格、上游成员、并发、协议和渠道。</p><button class="button secondary" data-reload>刷新数据</button>';toolbar.querySelector('button').onclick=load;
    globalPanel.id='meter-global';modelPanel.id='meter-models';ledgerPanel.id='meter-usage';
    const tabs=document.createElement('nav');tabs.className='meter-tabs';tabs.setAttribute('aria-label','计费分类');
    for(const [id,label] of [['meter-models','模型服务'],['meter-global','计费设置'],['meter-usage','用量记录']]){
      const button=document.createElement('button');button.type='button';button.textContent=label;
      button.onclick=()=>{[modelPanel,globalPanel,ledgerPanel].forEach(panel=>panel.hidden=panel.id!==id);[...tabs.children].forEach(b=>b.setAttribute('aria-pressed',String(b===button)));};
      tabs.append(button);
    }
    root.replaceChildren(toolbar,status,tabs,modelPanel,globalPanel,ledgerPanel);
    tabs.firstChild.click();
  }
  function appendServiceFields(form,model){
    const web=routes.find(route=>route.channel==='web_chat'&&route.modelId===model.upstream_id);
    const native=agentRoutes.find(route=>route.model_id===model.id);
    const members=new Map([...(web?.members||[]),...(native?.members||[])].map(member=>[member.profileId||member.profile_id,member]));
    const field=document.createElement('fieldset');field.className='route-members';
    field.innerHTML=`<legend>上游与渠道</legend><p>此处可在一个模型中配置上游、并发和协议。保存草稿不会开放调用。</p><div class="field-row"><label class="check-field"><input type="checkbox" name="serviceCodex" ${model.agent_enabled?'checked':''}>Responses 客户端</label><label class="check-field"><input type="checkbox" name="serviceNative" ${native?.enabled?'checked':''}>原生客户端</label></div><div class="field-row"><label>原生协议<select name="nativeProtocol"><option value="responses">Responses</option><option value="chat">Chat Completions</option></select></label></div><div class="service-members">${upstreams.map(profile=>{const member=members.get(profile.id);return `<div class="service-member"><label><input type="checkbox" name="serviceProfile" value="${esc(profile.id)}" ${member?'checked':''}>${esc(profile.name)} · ${esc(profile.keyHint)}</label><label>上游模型 ID<input name="upstreamModel_${esc(profile.id)}" value="${esc(member?.upstreamModelId||member?.upstream_model_id||model.upstream_id)}" maxlength="128"></label><label>最大并发<input name="concurrency_${esc(profile.id)}" type="number" min="1" max="1000" value="${Number(profile.maxConcurrency)||5}"></label></div>`}).join('')}</div><details><summary>添加新上游</summary><label>HTTPS API 端点<input name="newBaseUrl" type="url" placeholder="https://example.com/v1"></label><label>API Key<input name="newApiKey" type="password" autocomplete="new-password"></label><div class="field-row"><label>备注<input name="newName" maxlength="64"></label><label>最大并发<input name="newConcurrency" type="number" min="1" max="1000" value="5"></label></div></details><p data-service-status role="status"></p>`;
    field.querySelector('[name="nativeProtocol"]').value=native?.protocol||'responses';
    form.querySelector('.model-route-note')?.remove();form.querySelector('.model-global-toggle')?.remove();
    form.querySelector('[name="source"]').parentElement.firstChild.textContent='价格来源（HTTPS）';
    form.insertBefore(field,form.querySelector('button.button.primary'));
    form.querySelector('button.button.primary').textContent='保存禁用草稿';
    const publish=document.createElement('button');publish.type='button';publish.className='button secondary';publish.textContent='探测并启用';publish.onclick=()=>saveService(form,true);form.append(publish);
  }
  async function saveService(form,publish=false){
    if(saving)return;saving=true;const status=form.querySelector('[data-service-status]');status.textContent='正在保存模型服务…';
    const f=new FormData(form),modelId=form.dataset.model,price={tier:'default',source:f.get('source'),date:f.get('date')};
    for(const key of ['input','cached','write','output','longThreshold','longInput','longOutput'])price[key]=Number(f.get(key));
    const upstreamId=String(f.get('upstreamId')||'').trim();
    try{
      const members=[...new Set(f.getAll('serviceProfile'))].map((profileId,index)=>({profileId,upstreamModelId:String(f.get(`upstreamModel_${profileId}`)||upstreamId).trim(),priority:(index+1)*10,enabled:false}));
      if(f.get('newBaseUrl')||f.get('newApiKey')){
        const created=await api('/admin/upstreams',jsonOptions('POST',{baseUrl:f.get('newBaseUrl'),apiKey:f.get('newApiKey'),name:f.get('newName'),maxConcurrency:Number(f.get('newConcurrency'))}));
        members.push({profileId:created.upstream.id,upstreamModelId:upstreamId,priority:(members.length+1)*10,enabled:false});
      }
      if(!members.length)throw Error('请至少选择或添加一个上游。');
      for(const member of members){const old=upstreams.find(profile=>profile.id===member.profileId);const capacity=Number(f.get(`concurrency_${member.profileId}`));if(old&&capacity!==Number(old.maxConcurrency))await api(`/admin/upstreams/${member.profileId}`,jsonOptions('PUT',{name:old.name,maxConcurrency:capacity}));}
      await api(`/admin/metering/models/${encodeURIComponent(modelId)}`,jsonOptions('PUT',{upstreamId,enabled:false,web:false,agent:false,multiplierPpm:f.get('multiplier')===''?null:Math.round(Number(f.get('multiplier'))*1e6),price}));
      {const old=routes.find(route=>route.channel==='web_chat'&&route.modelId===upstreamId);if(old)await api('/admin/routes/web_chat',jsonOptions('PUT',{modelId:upstreamId,members:old.members.map(member=>({profileId:member.profileId,upstreamModelId:member.upstreamModelId||upstreamId,protocol:member.protocol||'chat',enabled:false}))}));}
      if(f.has('serviceCodex'))await api('/admin/routes/desktop_codex',jsonOptions('PUT',{modelId:upstreamId,members:members.map(member=>({...member,protocol:'responses'}))}));
      else {const old=routes.find(route=>route.channel==='desktop_codex'&&route.modelId===upstreamId);if(old)await api('/admin/routes/desktop_codex',jsonOptions('PUT',{modelId:upstreamId,members:old.members.map(member=>({profileId:member.profileId,upstreamModelId:member.upstreamModelId||upstreamId,protocol:'responses',enabled:false}))}));}
      if(f.has('serviceNative'))await api(`/admin/opencode/models/${encodeURIComponent(modelId)}`,jsonOptions('PUT',{members,protocol:f.get('nativeProtocol'),enabled:false}));
      else {const old=agentRoutes.find(route=>route.model_id===modelId);if(old?.members?.length)await api(`/admin/opencode/models/${encodeURIComponent(modelId)}`,jsonOptions('PUT',{members:old.members.map(member=>({profileId:member.profile_id,upstreamModelId:member.upstream_model_id||upstreamId,enabled:false})),protocol:old.protocol,enabled:false}));}
      if(publish){
        status.textContent='草稿已保存，正在执行真实上游探测…';
        for(const member of members){
          if(f.has('serviceCodex'))await api(`/admin/upstreams/${member.profileId}/test`,jsonOptions('POST',{channel:'desktop_codex',modelId:member.upstreamModelId,protocol:'responses'}));
          if(f.has('serviceNative'))await api(`/admin/opencode/models/${encodeURIComponent(modelId)}/probe`,jsonOptions('POST',{profileId:member.profileId,protocol:f.get('nativeProtocol')}));
        }
        if(f.has('serviceCodex'))await api('/admin/routes/desktop_codex',jsonOptions('PUT',{modelId:upstreamId,members:members.map(member=>({...member,protocol:'responses',enabled:true}))}));
        if(f.has('serviceNative'))await api(`/admin/opencode/models/${encodeURIComponent(modelId)}`,jsonOptions('PUT',{members:members.map(member=>({...member,enabled:true})),protocol:f.get('nativeProtocol'),enabled:true}));
        await api(`/admin/metering/models/${encodeURIComponent(modelId)}`,jsonOptions('PUT',{upstreamId,enabled:true,web:false,agent:f.has('serviceCodex')||f.has('serviceNative'),multiplierPpm:f.get('multiplier')===''?null:Math.round(Number(f.get('multiplier'))*1e6),price}));
      }
      status.textContent=publish?'探测通过，模型已启用。':'草稿已保存，模型暂不可用。';saving=false;await load();
    }catch(error){status.textContent=`未完成：${error.message}。已保存的草稿请刷新核对。`;}
    finally{saving=false;}
  }
  function openCreateModel(){
    const dialog=document.createElement('dialog');dialog.className='model-editor';
    dialog.innerHTML=`<form class="dialog-shell"><div class="dialog-heading"><h2>添加模型草稿</h2><button type="button" class="icon-control" data-close aria-label="关闭">×</button></div><label>BotGo 模型 ID<input name="id" pattern="[a-z0-9][a-z0-9._-]*" maxlength="128" required></label><label>显示名称<input name="name" maxlength="128" required></label><label>上游模型 ID<input name="upstreamId" maxlength="128" required></label><div class="field-row">${input('输入 USD / 百万 token','input',0)}${input('缓存读取','cached',0)}${input('缓存写入','write',0)}${input('输出','output',0)}</div><div class="field-row">${input('长上下文阈值','longThreshold',272000)}${input('长输入倍率','longInput',1)}${input('长输出倍率','longOutput',1)}</div><label>价格来源 HTTPS URL<input name="source" type="url" required></label><label>价格日期<input name="date" type="date" required></label><p role="status"></p><button class="button primary" type="submit">创建草稿</button></form>`;
    document.body.append(dialog);dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,f=new FormData(form),price={tier:'default',source:f.get('source'),date:f.get('date')};for(const key of ['input','cached','write','output','longThreshold','longInput','longOutput'])price[key]=Number(f.get(key));try{await api('/admin/metering/models',jsonOptions('POST',{id:f.get('id'),name:f.get('name'),upstreamId:f.get('upstreamId'),price}));dialog.close();await load();}catch(error){form.querySelector('[role="status"]').textContent=error.message;}};dialog.showModal();
  }
  async function save(path,method,body){
    if(saving||loading)return;
    if(method!=='DELETE'&&path.includes('/models/')&&!confirm('保存此模型配置？后续请求将按新价格计费。'))return;
    if(path.endsWith('/review')&&!confirm('确认已核对该请求，并解除此记录的账户限制？'))return;
    saving=true;const buttons=[...root.querySelectorAll('button')];buttons.forEach(button=>button.disabled=true);
    const status=root.querySelector('[data-meter-status]');status.textContent='正在保存…';status.scrollIntoView({block:'nearest'});let written=false;
    try{await api(path,jsonOptions(method,body));written=true;data=await api('/admin/metering');render();root.querySelector('[data-meter-status]').textContent='已保存，后续请求使用新配置。';}
    catch(error){status.textContent=(written?'配置已保存，但刷新失败；请重新加载确认。':'保存失败：')+error.message;}
    finally{saving=false;buttons.forEach(button=>button.disabled=false);}
  }
  window.addEventListener('botgo:admin-view',event=>{if(event.detail.view==='metering')load();});
  const dashboard=document.getElementById('admin-dashboard');new MutationObserver(()=>{if(!dashboard.hidden)load();}).observe(dashboard,{attributes:true,attributeFilter:['hidden']});if(!dashboard.hidden)load();
})();
