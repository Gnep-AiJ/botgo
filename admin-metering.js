(() => {
  const {api,jsonOptions,escapeHtml:esc}=window.BotGoAdmin;
  const root=document.querySelector('[data-admin-view="metering"]');
  let models=[],drafts=[],profiles=[],routes=[],busy=false;
  const defaultPrice=()=>({tier:'default',input:0,cached:0,write:0,output:0,longThreshold:272000,longInput:1,longOutput:1,source:'',date:new Date().toISOString().slice(0,10)});
  const priceFields=['input','cached','write','output','longThreshold','longInput','longOutput'];
  const savedModel=id=>models.find(item=>item.id===id);
  const savedDraft=id=>drafts.find(item=>item.modelId===id);
  function liveConfig(model){
    const route=routes.find(item=>item.model_id===model?.id);
    return {name:model?.name||'',upstreamId:model?.upstream_id||model?.id||'',price:model?.price||defaultPrice(),members:(route?.members||[]).filter(item=>item.profile_id&&profiles.some(profile=>profile.id===item.profile_id&&!profile.retired)).map((item,index)=>({profileId:item.profile_id,upstreamModelId:item.upstream_model_id||model?.upstream_id||model?.id,protocol:route.protocol||'responses',priority:(index+1)*10}))};
  }
  async function load(){
    if(busy||document.getElementById('admin-dashboard').hidden)return;
    busy=true;
    try{const [metering,staged,upstreams,agent]=await Promise.all([api('/admin/metering'),api('/admin/model-services'),api('/admin/upstreams'),api('/admin/opencode')]);models=metering.models||[];drafts=staged.drafts||[];profiles=upstreams.upstreams||[];routes=agent.routes||[];render();}
    catch(error){root.innerHTML=`<section class="panel"><h2>模型服务加载失败</h2><p role="alert">${esc(error.message)}</p><button class="button secondary" data-retry>重试</button></section>`;root.querySelector('[data-retry]').onclick=()=>{busy=false;load();};}
    finally{busy=false;}
  }
  function render(){
    const ids=[...new Set([...models.map(item=>item.id),...drafts.map(item=>item.modelId)])];
    root.innerHTML=`<div class="view-actions"><div><h2>模型服务</h2><p class="view-lead">保存和测试不会改变客户端配置</p></div><button class="button primary" data-new>添加模型</button></div><section class="panel"><div class="data-table"><table class="service-table"><thead><tr><th>模型</th><th>售价 输入 / 输出</th><th>状态</th><th>可用上游</th><th></th></tr></thead><tbody>${ids.map(id=>{const model=savedModel(id),draft=savedDraft(id),route=routes.find(item=>item.model_id===id),price=draft?.config.price||model?.price;const count=(route?.members||[]).filter(item=>item.enabled&&item.verified_at&&!item.retired_at).length;return `<tr><td><strong>${esc(draft?.config.name||model?.name||id)}</strong><small>${esc(id)}</small></td><td>$${Number(price?.input||0).toFixed(2)} / $${Number(price?.output||0).toFixed(2)}</td><td><span class="status-pill ${model?.enabled&&route?.enabled?'success':'neutral'}">${model?.enabled&&route?.enabled?'已发布':'未上架'}</span>${draft?'<small>有草稿</small>':''}</td><td>${count}</td><td><button type="button" class="table-button" data-edit="${esc(id)}">编辑</button></td></tr>`}).join('')}</tbody></table>${ids.length?'':'<p class="empty-state">暂无模型，点击“添加模型”开始配置。</p>'}</div></section><p class="action-status" data-status role="status"></p><dialog class="model-editor service-drawer" data-drawer></dialog>`;
    root.querySelector('[data-new]').onclick=()=>open('');root.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>open(button.dataset.edit));
    if(window.BotGoAdminPendingModel&&ids.includes(window.BotGoAdminPendingModel)){const id=window.BotGoAdminPendingModel;window.BotGoAdminPendingModel='';open(id);}
  }
  function open(id){
    const model=savedModel(id),draft=savedDraft(id),config=draft?.config||liveConfig(model),tested=draft?.tested||{},dialog=root.querySelector('[data-drawer]');
    dialog.innerHTML=`<form class="dialog-shell service-form"><div class="dialog-heading"><h2>${id?'编辑模型':'添加模型'}</h2><button type="button" class="icon-control" data-close aria-label="关闭">×</button></div><section class="drawer-section"><h3>基本信息</h3><label>模型 ID<input name="id" value="${esc(id)}" ${id?'readonly':''} pattern="[a-z0-9][a-z0-9._-]*" maxlength="128" required></label><label>显示名称<input name="name" value="${esc(config.name)}" maxlength="128" required></label><label>默认上游模型 ID<input name="upstreamId" value="${esc(config.upstreamId)}" maxlength="128" required></label></section><section class="drawer-section"><h3>价格 · USD / 百万 token</h3><div class="field-row">${priceFields.slice(0,4).map(key=>`<label>${({input:'输入',cached:'缓存读取',write:'缓存写入',output:'输出'})[key]}<input type="number" name="${key}" min="0" step="any" value="${Number(config.price[key]||0)}" required></label>`).join('')}</div><details><summary>长上下文价格</summary><div class="field-row">${priceFields.slice(4).map(key=>`<label>${({longThreshold:'阈值',longInput:'输入倍率',longOutput:'输出倍率'})[key]}<input type="number" name="${key}" min="1" step="any" value="${Number(config.price[key]||1)}" required></label>`).join('')}</div></details><label>价格来源<input type="url" name="source" value="${esc(config.price.source)}" placeholder="https://" required></label><label>价格日期<input type="date" name="date" value="${esc(config.price.date)}" required></label></section><section class="drawer-section"><h3>上游绑定</h3><p>地址、Key 和总并发在“上游连接”维护</p><div class="data-table"><table><thead><tr><th>上游</th><th>实际模型 ID</th><th>协议</th><th>顺序</th><th>测试</th></tr></thead><tbody>${profiles.filter(profile=>!profile.retired).map(profile=>{const item=config.members.find(member=>member.profileId===profile.id);return `<tr><td><label class="check-field"><input type="checkbox" name="profile" value="${esc(profile.id)}" ${item?'checked':''}>${esc(profile.name)}</label></td><td><input name="model_${esc(profile.id)}" value="${esc(item?.upstreamModelId||config.upstreamId)}" maxlength="128"></td><td><select name="protocol_${esc(profile.id)}"><option value="responses" ${item?.protocol==='responses'?'selected':''}>Responses</option><option value="chat" ${item?.protocol==='chat'?'selected':''}>Chat</option></select></td><td><input type="number" name="priority_${esc(profile.id)}" min="0" max="10000" value="${item?.priority??100}"></td><td>${tested[profile.id]?'通过':'待测试'}</td></tr>`}).join('')}</tbody></table>${profiles.some(profile=>!profile.retired)?'':'<p class="empty-state">先在“上游连接”添加上游</p>'}</div></section><p class="action-status" data-feedback role="status"></p><div class="form-actions service-actions"><button type="button" class="button secondary" data-save>保存草稿</button><button type="button" class="button secondary" data-test>测试</button><button type="button" class="button primary" data-publish>发布</button>${model?.enabled?'<button type="button" class="table-button danger" data-unpublish>下架</button>':''}</div></form>`;
    dialog.querySelector('[data-close]').onclick=()=>dialog.close();dialog.querySelector('form').onsubmit=event=>{event.preventDefault();action('save');};
    dialog.querySelectorAll('select[name^="protocol_"]').forEach(select=>select.onchange=()=>dialog.querySelectorAll('select[name^="protocol_"]').forEach(peer=>{peer.value=select.value;}));
    dialog.querySelector('[data-save]').onclick=()=>action('save');dialog.querySelector('[data-test]').onclick=()=>action('test');dialog.querySelector('[data-publish]').onclick=()=>action('publish');dialog.querySelector('[data-unpublish]')?.addEventListener('click',()=>action('unpublish'));dialog.showModal();
  }
  function readForm(){
    const form=root.querySelector('.service-form');if(!form.reportValidity())return null;
    const f=new FormData(form),id=String(f.get('id')).trim();const price={tier:'default',source:String(f.get('source')),date:String(f.get('date'))};for(const key of priceFields)price[key]=Number(f.get(key));
    return {id,config:{name:String(f.get('name')).trim(),upstreamId:String(f.get('upstreamId')).trim(),price,members:f.getAll('profile').map(profileId=>({profileId,upstreamModelId:String(f.get(`model_${profileId}`)).trim(),protocol:String(f.get(`protocol_${profileId}`)),priority:Number(f.get(`priority_${profileId}`))}))}};
  }
  async function action(kind){
    if(busy)return;const input=readForm();if(!input)return;const {id,config}=input,feedback=root.querySelector('[data-feedback]');
    if((kind==='test'||kind==='publish')&&JSON.stringify(config)!==JSON.stringify(savedDraft(id)?.config)){feedback.textContent='配置已修改，请先保存草稿。';return;}
    busy=true;feedback.textContent='处理中…';
    try{
      if(kind==='save')await api(`/admin/model-services/${encodeURIComponent(id)}`,jsonOptions('PUT',config));
      if(kind==='test'){const result=await api(`/admin/model-services/${encodeURIComponent(id)}/test`,{method:'POST'});feedback.textContent=result.results.map(item=>`${profiles.find(profile=>profile.id===item.profileId)?.name||item.profileId}：${item.ok?'通过':(item.code+' / '+item.stage+(item.upstreamStatus?' HTTP '+item.upstreamStatus:''))}`).join('；');}
      if(kind==='publish')await api(`/admin/model-services/${encodeURIComponent(id)}/publish`,{method:'POST'});
      if(kind==='unpublish'){
        const model=savedModel(id);if(!model||!confirm(`下架 ${model.name}？客户端将无法继续调用。`))return;
        await api(`/admin/metering/models/${encodeURIComponent(id)}`,jsonOptions('PUT',{upstreamId:model.upstream_id,enabled:false,web:false,agent:false,multiplierPpm:model.multiplier_ppm,price:model.price}));
      }
      if(kind!=='test'){root.querySelector('[data-drawer]').close();busy=false;await load();root.querySelector('[data-status]').textContent=({save:'草稿已保存，线上配置未变。',publish:'已发布到客户端。',unpublish:'模型已下架。'})[kind];}
    }catch(error){feedback.textContent=`${kind==='test'?'测试':'操作'}失败：${error.message}`;}
    finally{busy=false;}
  }
  window.addEventListener('botgo:admin-view',event=>{if(event.detail.view==='metering')load();});
  window.addEventListener('botgo:admin-view',async event=>{
    if(event.detail.view!=='billing')return;
    const target=document.getElementById('call-ledger');
    try{const response=await api('/admin/metering');const records=(response.ledger||[]).filter(item=>item.channel==='desktop_opencode');
      target.innerHTML=records.length?`<table><thead><tr><th>时间</th><th>模型</th><th>状态</th><th>消费金额</th><th>错误 / 用量</th></tr></thead><tbody>${records.map(item=>`<tr><td>${esc(item.created_at)}</td><td>${esc(item.model)}</td><td>${esc(item.state)}</td><td>¥${(Number(item.charged_micros||0)/1e6).toFixed(6)}</td><td><details><summary>查看</summary><pre>${esc(item.usage_json||'待核对或无用量')}\n${esc(item.snapshot||'')}</pre>${item.state==='review'&&!item.reviewed_at?`<button type="button" class="table-button" data-review="${esc(item.id)}">确认核对</button>`:''}</details></td></tr>`).join('')}</tbody></table>`:'<p class="empty-state">暂无客户端调用记录</p>';
      target.querySelectorAll('[data-review]').forEach(button=>button.onclick=async()=>{const note=prompt('填写核对结果和处理说明');if(!note||note.trim().length<4)return;try{await api('/admin/metering/review',jsonOptions('POST',{id:button.dataset.review,note:note.trim()}));window.dispatchEvent(new CustomEvent('botgo:admin-view',{detail:{view:'billing'}}));}catch(error){alert(error.message);}});
    }catch(error){target.innerHTML=`<p role="alert">${esc(error.message)}</p>`;}
  });
  new MutationObserver(()=>{if(!document.getElementById('admin-dashboard').hidden)load();}).observe(document.getElementById('admin-dashboard'),{attributes:true,attributeFilter:['hidden']});
})();
