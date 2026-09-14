(() => {
  const {api,jsonOptions,escapeHtml:esc}=window.BotGoAdmin;
  const root=document.querySelector('[data-admin-view="metering"]');
  let data=null,loading=false,saving=false;
  const input=(label,name,value,type='number')=>`<label>${label}<input name="${name}" type="${type}" value="${esc(String(value))}" ${type==='number'?'min="0" step="any"':''} required></label>`;
  async function load(){
    if(loading||saving||document.getElementById('admin-dashboard').hidden)return;
    loading=true;root.setAttribute('aria-busy','true');root.querySelectorAll('button').forEach(button=>button.disabled=true);
    try{data=await api('/admin/metering');if(!data.settings||!Array.isArray(data.models)||!Array.isArray(data.ledger))throw Error('计费数据不完整。');render();}
    catch(error){root.innerHTML='<section class="panel"><h2>暂时无法加载</h2><p class="action-status" role="status">'+esc(error.message)+'</p><button class="button secondary" data-reload>重新加载</button></section>';root.querySelector('[data-reload]').onclick=load;}
    finally{loading=false;root.removeAttribute('aria-busy');root.querySelectorAll('button').forEach(button=>button.disabled=false);}
  }
  function render(){root.innerHTML=`<div class="panel-heading"><h2>模型与用量计费</h2><button type="button" class="button secondary" data-seed>初始化模型目录</button></div><form data-settings class="settings-form"><div class="field-row">${input('计费倍率','multiplier',data.settings.multiplier_ppm/1e6)}${input('USD/CNY 计价汇率','usdCny',data.settings.usd_cny_ppm/1e6)}</div><label>默认模型<select name="defaultModel">${data.models.filter(m=>m.enabled).map(m=>`<option value="${esc(m.id)}" ${m.id===data.settings.default_model?'selected':''}>${esc(m.name)}</option>`).join('')}</select></label><button class="button primary">保存设置</button></form><div data-models>${data.models.map(m=>`<details><summary>${esc(m.name)} · ${m.enabled?'已启用':'未启用'}</summary><form data-model="${esc(m.id)}" class="settings-form">${input('上游模型标识','upstreamId',m.upstream_id,'text')}<div class="field-row"><label>启用<input name="enabled" type="checkbox" ${m.enabled?'checked':''}></label><label>网页<input name="web" type="checkbox" ${m.web_enabled?'checked':''}></label><label>Agent<input name="agent" type="checkbox" ${m.agent_enabled?'checked':''}></label></div><label>模型倍率（留空继承）<input type="number" min="0.000001" step="any" name="multiplier" value="${m.multiplier_ppm===null?'':m.multiplier_ppm/1e6}"></label><div class="field-row">${input('输入 USD / 百万 token','input',m.price.input)}${input('缓存读取','cached',m.price.cached)}${input('缓存写入','write',m.price.write)}${input('输出','output',m.price.output)}</div><div class="field-row">${input('长上下文阈值','longThreshold',m.price.longThreshold)}${input('长输入倍率','longInput',m.price.longInput)}${input('长输出倍率','longOutput',m.price.longOutput)}</div>${input('官方价格来源','source',m.price.source,'url')}${input('价格日期','date',m.price.date,'date')}<p>修改仅影响后续请求。</p><button class="button primary">保存</button></form></details>`).join('')}</div><h3>最近用量与核对记录</h3><div class="data-table"><table><thead><tr><th>时间</th><th>模型 / 渠道</th><th>状态</th><th>费用 / 实扣（元）</th><th>明细</th></tr></thead><tbody>${data.ledger.map(r=>`<tr><td>${esc(r.created_at)}</td><td>${esc(r.model)}<small>${esc(r.channel)}</small></td><td>${esc(r.state)}</td><td>${(r.cost_micros/1e6).toFixed(6)} / ${(r.charged_micros/1e6).toFixed(6)}</td><td><details><summary>查看</summary><pre>${esc(r.usage_json||'无可核验用量')}\n${esc(r.snapshot)}</pre></details></td></tr>`).join('')}</tbody></table></div><p data-meter-status role="status"></p>`;
    organizePanels();
    root.querySelector('[data-seed]').onclick=()=>{if(confirm('补充缺少的默认模型？现有价格不会被覆盖。'))save('/admin/metering/seed','POST',{});};
    for(const record of data.ledger.filter(r=>r.state==='review'&&!r.reviewed_at)){
      const form=document.createElement('form');form.className='settings-form';
      const label=document.createElement('label');label.textContent=`核对 ${record.model} · ${record.id}`;
      const input=document.createElement('input');input.required=true;input.minLength=4;input.maxLength=500;input.placeholder='记录核对结果及处理说明';label.append(input);
      const button=document.createElement('button');button.type='submit';button.textContent='确认核对';
      form.append(label,button);form.onsubmit=e=>{e.preventDefault();save('/admin/metering/review','POST',{id:record.id,note:input.value});};form.classList.add('review-card');button.className='button secondary';
      root.querySelector(`[data-ledger-index="${data.ledger.indexOf(record)}"] details`).append(form);
    }
    root.querySelector('[data-settings]').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);save('/admin/metering/settings','PUT',{multiplierPpm:Math.round(Number(f.get('multiplier'))*1e6),usdCnyPpm:Math.round(Number(f.get('usdCny'))*1e6),defaultModel:f.get('defaultModel')});};
    root.querySelectorAll('[data-model]').forEach(form=>form.onsubmit=e=>{e.preventDefault();const f=new FormData(form),price={tier:'default',source:f.get('source'),date:f.get('date')};for(const k of ['input','cached','write','output','longThreshold','longInput','longOutput'])price[k]=Number(f.get(k));save(`/admin/metering/models/${form.dataset.model}`,'PUT',{upstreamId:f.get('upstreamId'),enabled:f.has('enabled'),web:f.has('web'),agent:f.has('agent'),multiplierPpm:f.get('multiplier')===''?null:Math.round(Number(f.get('multiplier'))*1e6),price});});
  }
  function organizePanels(){
    const heading=root.querySelector('.panel-heading'),settings=root.querySelector('[data-settings]'),models=root.querySelector('[data-models]'),ledger=root.querySelector('.data-table'),title=root.querySelector('h3'),status=root.querySelector('[data-meter-status]');
    status.className='meter-status';status.setAttribute('aria-live','polite');heading.querySelector('h2').textContent='全局设置';
    const seed=heading.querySelector('[data-seed]');seed.textContent='补充默认模型';settings.classList.add('meter-settings');
    const section=title=>{const node=document.createElement('section');node.className='panel';if(title){const h=document.createElement('h2');h.textContent=title;node.append(h);}return node;};
    const globalPanel=section();globalPanel.append(heading,settings);
    const modelPanel=section();const modelHeading=document.createElement('div');modelHeading.className='panel-heading';modelHeading.innerHTML='<h2>模型配置</h2>';modelHeading.append(seed);models.className='model-list';modelPanel.append(modelHeading,models);
    [...models.children].forEach((detail,index)=>{detail.className='model-card';const model=data.models[index],summary=detail.querySelector('summary');const label=document.createElement('span');label.className='model-name';label.textContent=model.name;const channels=document.createElement('small');channels.textContent=[model.web_enabled?'网页':'',model.agent_enabled?'Agent':''].filter(Boolean).join(' · ')||'未开放渠道';label.append(channels);const badge=document.createElement('span');badge.className='status-pill '+(model.enabled?'success':'neutral');badge.textContent=model.enabled?'已启用':'未启用';summary.replaceChildren(label,badge);
      const remove=document.createElement('button');remove.type='button';remove.className='table-button danger';remove.textContent='删除';
      remove.onclick=event=>{event.preventDefault();event.stopPropagation();if(confirm('删除此模型？历史计费记录会保留。'))save('/admin/metering/models/'+model.id,'DELETE',{});};
      summary.append(remove);
      const edit=document.createElement('button');edit.type='button';edit.className='table-button';edit.textContent='编辑';summary.append(edit);
      const form=detail.querySelector('form');const flags=form.querySelector('input[type=checkbox]')?.closest('.field-row');if(flags)flags.className='model-flags';
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
    const toolbar=document.createElement('div');toolbar.className='view-actions';toolbar.innerHTML='<p class="view-lead">管理模型、价格与请求用量。</p><button class="button secondary" data-reload>刷新数据</button>';toolbar.querySelector('button').onclick=load;
    globalPanel.id='meter-global';modelPanel.id='meter-models';ledgerPanel.id='meter-usage';
    const nativePanel=section();nativePanel.id='meter-opencode';window.BotGoAgentAdmin?.mount(nativePanel,data.models);
    const tabs=document.createElement('nav');tabs.className='meter-tabs';tabs.setAttribute('aria-label','计费分类');
    for(const [id,label] of [['meter-models','模型目录'],['meter-global','计费设置'],['meter-usage','用量记录'],['meter-opencode','客户端渠道']]){
      const button=document.createElement('button');button.type='button';button.textContent=label;
      button.onclick=()=>{[modelPanel,globalPanel,ledgerPanel,nativePanel].forEach(panel=>panel.hidden=panel.id!==id);[...tabs.children].forEach(b=>b.setAttribute('aria-pressed',String(b===button)));};
      tabs.append(button);
    }
    root.replaceChildren(toolbar,status,tabs,modelPanel,globalPanel,ledgerPanel,nativePanel);
    tabs.firstChild.click();
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
