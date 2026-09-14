(() => {
  const {api,jsonOptions,escapeHtml:esc}=window.BotGoAdmin;
  window.BotGoAgentAdmin={mount(root,models){
    let busy=false;
    root.innerHTML='<h2>客户端渠道</h2><p>保存、测试，再启用。</p><p role="status" data-status>正在读取…</p><div data-routes></div>';
    const status=root.querySelector('[data-status]'),list=root.querySelector('[data-routes]');
    async function load(){
      try{
        const [data,profiles]=await Promise.all([api('/admin/opencode'),api('/admin/upstreams')]);
        list.replaceChildren();
        for(const model of models){
          const route=data.routes.find(r=>r.model_id===model.id);
          const form=document.createElement('form');form.className='settings-form panel';form.dataset.saved=route?'true':'';
          form.innerHTML=`<h3>${esc(model.name)}</h3><p>${route?.blocked_reason?'上游用量待核对':route?.verified_at?'已验证':'尚未验证'} · ${route?.enabled?'路由已启用':'路由未启用'}${!model.enabled||!model.agent_enabled?' · 请在模型目录启用模型与 Agent':''}</p>
            <div class="field-row"><label>上游<select name="profileId" required>${profiles.upstreams.map(p=>`<option value="${esc(p.id)}" ${p.id===route?.profile_id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label>
            <label>协议<select name="protocol"><option value="chat" ${route?.protocol==='chat'?'selected':''}>Chat Completions</option><option value="responses" ${route?.protocol==='responses'?'selected':''}>Responses</option></select></label></div>
            <label><input name="enabled" type="checkbox" ${route?.enabled?'checked':''}>启用此路由</label>
            <details><summary>上游成本估算（可选）</summary><p>美元 / 百万 token；仅用于估算，不替代供应商账单。</p><div class="field-row">${['input','cached','write','output'].map((k,i)=>`<label>${['输入','缓存读取','缓存写入','输出'][i]}<input name="cost-${k}" type="number" min="0" step="any" value="${esc(String(route?.cost_price_json?JSON.parse(route.cost_price_json)[k]:''))}"></label>`).join('')}</div></details>
            <div class="form-actions"><button class="button secondary" type="submit">保存路由</button><button class="button primary" type="button" data-probe ${route?'':'disabled'}>测试已保存路由</button></div>`;
          const run=async(path,method,body)=>{
            if(busy)return;busy=true;root.setAttribute('aria-busy','true');root.querySelectorAll('button').forEach(b=>b.disabled=true);
            status.textContent='正在处理…';
            try{await api(path,jsonOptions(method,body));if(await load())status.textContent='操作完成；配置仅影响后续请求。';}
            catch(error){status.textContent=error.message;}
            finally{busy=false;root.removeAttribute('aria-busy');root.querySelectorAll('button').forEach(b=>b.disabled=b.hasAttribute('data-probe')&&!b.closest('form').dataset.saved);}
          };
          form.onsubmit=e=>{
            e.preventDefault();const f=new FormData(form),costKeys=['input','cached','write','output'];
            const hasCost=costKeys.some(k=>f.get('cost-'+k)!=='');
            if(hasCost&&costKeys.some(k=>f.get('cost-'+k)==='')){status.textContent='请完整填写四项成本，或全部留空。';return;}
            run('/admin/opencode/models/'+model.id,'PUT',{profileId:f.get('profileId'),protocol:f.get('protocol'),enabled:f.has('enabled'),
              costPrice:hasCost?Object.fromEntries(costKeys.map(k=>[k,Number(f.get('cost-'+k))])):null});
          };
          form.querySelector('[data-probe]').onclick=()=>{
            if(confirm('测试已保存的上游配置？将发起两次真实模型请求并消耗上游额度。'))run('/admin/opencode/models/'+model.id+'/probe','POST',{});
          };
          list.append(form);
        }
        status.textContent='';return true;
      }catch(error){status.textContent='加载失败：'+error.message;return false;}
    }
    load();
  }};
})();
