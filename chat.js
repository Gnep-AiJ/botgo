import { attachmentKind, attachmentModelHint, attachmentPrompt, maxAttachments, prepareChatAttachment } from './chat-attachments.js';

(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  function applyTheme(theme){
    document.documentElement.dataset.theme=theme;
    const themeLabel=theme==='dark'?'切换为浅色主题':'切换为深色主题';
    $('theme-toggle').setAttribute('aria-label',themeLabel);
    $('theme-toggle').title=themeLabel;
    document.querySelector('.city-backdrop img').src=theme==='dark'?'./assets/botgo-account-skyline-user.webp':'./assets/botgo-city-clean-v2.webp';
    document.querySelector('.city-backdrop source').srcset=theme==='dark'?'./assets/botgo-account-skyline-user.webp':'./assets/botgo-city-clean-mobile.webp';
  }
  let savedTheme='light';try{if(localStorage.getItem('botgo-web-theme')==='dark')savedTheme='dark';}catch{}
  applyTheme(savedTheme);
  $('theme-toggle').addEventListener('click',()=>{
    const theme=document.documentElement.dataset.theme==='dark'?'light':'dark';applyTheme(theme);
    try{localStorage.setItem('botgo-web-theme',theme);}catch{}
  });
  const topics={general:{name:'百科',title:'你好，想聊些什么？',placeholder:'从这里说起…',note:'重要信息，记得再确认',suggestions:['解答疑问','写下想法','理理思路']},doctor:{name:'医生',title:'说说近况，慢慢来。',placeholder:'说说哪里不舒服…',note:'仅供参考，不替代就医',suggestions:['看懂体检','就诊准备','了解症状']},tarot:{name:'塔罗牌',title:'让牌面，回应心事。',placeholder:'写下心里的疑问…',note:'巴纳姆之镜，映见心底的回响。',suggestions:['聊聊感情','工作方向','最近的心事']}};
  const readLocation=()=>location.hash.match(/^#(general|doctor|tarot)(?:\/([a-zA-Z0-9_-]{16,128}))?$/);
  const initialLocation=readLocation();
  let topic=initialLocation?.[1]||'general',pendingConversation=initialLocation?.[2]||null,account=null,models=[],conversation=null,messages=[],historyRows=[],hasMore=false;
  let busy=false,loading=false,controller=null,authEpoch=0,viewEpoch=0,historyEpoch=0,modelEpoch=0,verifying=false,webSearch=false;
  let activeTurn=null,stopping=null;
  const drafts=new Map();let draftTimer,renameId=null;
  const attachmentDrafts=new Map();
  let attachmentJob=null,attachmentNotice='',attachmentNoticeError=false;
  try{
    const saved=JSON.parse(sessionStorage.getItem('botgo-web-drafts')||'[]');
    if(Array.isArray(saved))for(const item of saved.slice(-24)){
      if(Array.isArray(item)&&typeof item[0]==='string'&&item[0].length<512&&typeof item[1]==='string'&&item[1].length<=100000)drafts.set(item[0],item[1]);
    }
  }catch{}
  const draftKey=()=>JSON.stringify([account?.email||'',topic,conversation?.id||'']);
  const draftAttachments=()=>attachmentDrafts.get(draftKey())||[];
  const supportsAttachments=()=>models.some(model=>model.id===$('model').value&&model.attachments);
  const visualHistory=()=>messages.some((message,index)=>message.role==='user'&&message.attachments?.length&&['completed','stopped'].includes(messages[index+1]?.state));
  function saveAttachmentDraft(key,files){
    attachmentDrafts.delete(key);
    if(files.length)attachmentDrafts.set(key,files);
    if(attachmentDrafts.size>6)attachmentDrafts.delete(attachmentDrafts.keys().next().value);
  }
  function resetAttachmentWork(){
    attachmentJob?.abort();attachmentJob=null;attachmentNotice='';attachmentNoticeError=false;
    $('chat-form').classList.remove('is-dropping');
  }
  function attachmentStatus(text='',error=false){
    attachmentNotice=text;attachmentNoticeError=error;controls();
  }
  function canAddAttachments(){
    if(busy||loading||attachmentJob||messages.some(row=>row.role==='assistant'&&row.state==='running'))return false;
    if(!account){$('auth-dialog').showModal();$('email').focus();return false;}
    if(!models.some(model=>model.attachments)){attachmentStatus('暂无可接收附件的模型。',true);return false;}
    return true;
  }
  async function addAttachments(files){
    if(!files.length||!canAddAttachments())return;
    const key=draftKey(),job=new AbortController(),next=[...draftAttachments()];
    attachmentJob=job;attachmentStatus('正在处理附件…');
    let issue='';
    try{
      for(const file of files){
        if(next.length>=maxAttachments){issue||='每条消息最多添加 4 个附件。';break;}
        const kind=attachmentKind(file);
        if(!kind){issue||='支持 JPG、PNG、WebP 图片和 MP4、WebM、MOV 视频。';continue;}
        if(kind==='video'&&next.some(item=>item.kind==='video')){issue||='每条消息最多添加 1 个视频。';continue;}
        try{next.push(await prepareChatAttachment(file,kind,job.signal));}
        catch(error){
          if(job.signal.aborted)return;
          issue||=error.name==='TimeoutError'?'附件处理超时，请尝试较小的文件。':error.message;
        }
        if(job.signal.aborted||key!==draftKey())return;
      }
      saveAttachmentDraft(key,next);renderAttachmentDraft();
    }finally{
      if(attachmentJob===job){attachmentJob=null;attachmentStatus(issue,!!issue);}
    }
  }
  function showImagePreview(url,title,alt,download=''){
    $('image-preview-title').textContent=title;
    $('image-preview-full').alt=alt;$('image-preview-full').src=url;
    const link=$('image-download');link.hidden=!download;
    if(download)link.href=download;else link.removeAttribute('href');
    $('image-dialog').showModal();
  }
  function attachmentCard(file,index,editable=false){
    const card=document.createElement('div');card.className='chat-attachment';
    const url=file.frames?.[0]?.data||file.url;
    if(url){
      const preview=document.createElement('button'),image=document.createElement('img');
      preview.type='button';preview.className='attachment-preview';
      const type=file.kind==='video'?'视频首帧':'图片';
      preview.setAttribute('aria-label','查看'+type+' '+file.name);
      image.alt='';image.src=url;if(!editable)image.loading='lazy';
      image.addEventListener('error',()=>{image.hidden=true;preview.disabled=true;preview.title='预览暂不可用';});
      preview.addEventListener('click',()=>showImagePreview(url,type,file.name));
      preview.append(image);card.append(preview);
    }
    const detail=document.createElement('div'),name=document.createElement('span'),kind=document.createElement('small');
    detail.className='attachment-detail';name.textContent=file.name;name.title=file.name;
    kind.textContent=file.kind==='video'?`视频画面 · ${file.frameCount??file.frames.length} 帧`:'图片';
    detail.append(name,kind);card.append(detail);
    if(editable){
      const remove=document.createElement('button');remove.type='button';remove.className='attachment-remove';remove.textContent='×';
      remove.setAttribute('aria-label','移除 '+file.name);
      remove.addEventListener('click',()=>{
        saveAttachmentDraft(draftKey(),draftAttachments().filter((_,at)=>at!==index));
        renderAttachmentDraft();attachmentStatus();
        ($('chat-attachments').querySelectorAll('.attachment-remove')[index]||$('attach')).focus();
      });
      card.append(remove);
    }
    return card;
  }
  function renderAttachmentDraft(){
    const list=$('chat-attachments'),files=draftAttachments();
    list.hidden=!files.length;list.replaceChildren(...files.map((file,index)=>attachmentCard(file,index,true)));
  }
  function persistDrafts(){
    clearTimeout(draftTimer);
    try{sessionStorage.setItem('botgo-web-drafts',JSON.stringify([...drafts]));$('draft-status').textContent=$('chat-input').value?'草稿':'';$('draft-status').title='';}
    catch{$('draft-status').textContent=$('chat-input').value?'草稿未保存':'';$('draft-status').title='刷新前请先复制输入内容';}
  }
  function captureDraft(){
    const key=draftKey(),value=$('chat-input').value;drafts.delete(key);if(value)drafts.set(key,value);
    while(drafts.size>24)drafts.delete(drafts.keys().next().value);
    clearTimeout(draftTimer);draftTimer=setTimeout(persistDrafts,180);
  }
  function resizeInput(){const input=$('chat-input');input.style.height='auto';input.style.height=input.value?Math.min(160,input.scrollHeight)+'px':'';controls();}
  function restoreDraft(){ $('chat-input').value=drafts.get(draftKey())||'';resizeInput(); }
  function clearDrafts(){drafts.clear();attachmentDrafts.clear();clearTimeout(draftTimer);try{sessionStorage.removeItem('botgo-web-drafts');}catch{}}
  const logoutChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('botgo-web-auth'):null;
  function status(text='',error=false,recharge=false){
    const node=$('status');node.textContent=text;node.classList.toggle('is-error',error);
    if(recharge){
      const link=document.createElement('a');link.href='./index.html?panel=recharge';link.textContent='查看余额和充值';
      node.append(' ',link);
    }
  }
  const isNearBottom=()=> $('scroll-area').scrollHeight-$('scroll-area').scrollTop-$('scroll-area').clientHeight<100;
  function bottom(){ $('scroll-area').scrollTop=$('scroll-area').scrollHeight;$('jump-latest').hidden=true; }
  function controls(){
    const runningElsewhere=!busy&&messages.some(row=>row.role==='assistant'&&row.state==='running');
    const files=draftAttachments(),needsVision=!!account&&!!$('model').value&&(files.length||visualHistory())&&!supportsAttachments();
    $('send').disabled=busy||loading||runningElsewhere||!!attachmentJob||(!$('chat-input').value.trim()&&!files.length)||(!!account&&!$('model').value)||needsVision;
    $('attach').disabled=busy||loading||runningElsewhere||!!attachmentJob;
    const attachmentStatusNode=$('attachment-status');
    attachmentStatusNode.textContent=attachmentNotice||(needsVision?attachmentModelHint:'');
    attachmentStatusNode.classList.toggle('is-error',attachmentNotice?attachmentNoticeError:!!needsVision);
    document.querySelectorAll('.attachment-remove').forEach(button=>button.disabled=busy||loading||!!attachmentJob);
    $('send').hidden=busy||runningElsewhere;$('stop').hidden=!(busy||runningElsewhere);$('stop').disabled=!!stopping;
    $('model').disabled=busy||loading||!models.length;
    $('chat-input').maxLength=100000;
    $('chat-input').placeholder=topics[topic].placeholder;
    const canSearch=models.some(m=>m.id===$('model').value&&m.webSearch);
    webSearch=canSearch;
    $('web-search').hidden=!canSearch;
    $('web-search').title='模型按问题决定是否搜索';
    $('draw-cards').hidden=topic!=='tarot'||!!conversation;
    $('draw-cards').disabled=busy||loading;
    $('new-chat').disabled=busy||loading;
    document.querySelectorAll('button[data-topic]').forEach(b=>b.disabled=busy||loading);
    document.querySelectorAll('.message-retry,.message-refresh').forEach(b=>b.disabled=busy||loading);
  }
  function saveLocation(){history.replaceState(null,'',location.pathname+location.search+'#'+topic+(conversation?'/'+conversation.id:''));}
  async function restoreConversation(){
    if(!pendingConversation||!account)return;
    const id=pendingConversation;pendingConversation=null;await openConversation(id);saveLocation();
  }
  function resetView(){viewEpoch++;resetAttachmentWork();conversation=null;messages=[];$('draft-status').textContent='';saveLocation();restoreDraft();render();}
  function clearSession(){
    if(account)clearDrafts();else captureDraft();
    authEpoch++;modelEpoch++;historyEpoch++;controller?.abort();controller=null;busy=false;loading=false;
    account=null;models=[];historyRows=[];hasMore=false;webSearch=false;resetView();renderHistory();renderAccount();
    $('model').replaceChildren(new Option('登录后选择模型',''));$('retry-models').hidden=true;controls();
    $('email').value='';$('code').value='';resetAuth();
    $('rename-dialog').close();renameId=null;
  }
  async function api(path,options={}){
    const epoch=authEpoch;
    let response;
    try{response=await fetch('/api'+path,{credentials:'same-origin',signal:AbortSignal.timeout(10000),...options});}
    catch(error){if(error.name==='TimeoutError')throw new DOMException('请求超时，请重试','TimeoutError');if(error instanceof TypeError)throw new TypeError('连接中断，请重试');throw error;}
    const body=await response.json().catch(()=>({}));
    if(epoch!==authEpoch)throw new DOMException('Account changed','AbortError');
    if(!response.ok){if(response.status===401)clearSession();const error=new Error(body.error||'请求未完成');error.status=response.status;throw error;}
    return body;
  }
  const post=(path,body)=>api(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  function renderAccount(){
    $('account-button').textContent=account?'账户':'登录';
    $('account-button').title=account?.email||'登录';$('logout').hidden=!account;
  }
  async function refreshAccount(){
    const data=await api('/account',{signal:AbortSignal.timeout(10000)});
    if(!data.account||typeof data.account!=='object')throw new Error('账户接口返回异常');
    const first=!account;account=data.account;renderAccount();if(first)restoreDraft();
  }
  async function loadModels(){
    const epoch=++modelEpoch;
    $('retry-models').hidden=true;
    if(!models.length)$('model').replaceChildren(new Option('加载模型…',''));
    try{
      const data=await api('/chat/models',{signal:AbortSignal.timeout(10000)});if(epoch!==modelEpoch)return;
      models=data.models||[];
      let saved='';try{saved=localStorage.getItem('botgo-web-model')||'';}catch{}
      const hasVision=models.some(m=>m.attachments);
      $('model').replaceChildren(...models.map(m=>new Option(m.name+(hasVision&&!m.attachments?' · 仅文字':''),m.id)));
      $('model').value=models.some(m=>m.id===saved)?saved:data.defaultModel;
      if(!models.length){$('model').append(new Option('暂无可用模型',''));status('暂无已验证模型',true);}
      controls();
    }catch(error){if(error.name==='AbortError'||epoch!==modelEpoch)return;models=[];$('model').replaceChildren(new Option('模型加载失败',''));$('retry-models').hidden=!account;status(error.name==='TimeoutError'?'模型连接超时，请重试':error instanceof TypeError?'无法连接模型服务，请重试':error.message,true);controls();}
  }
  async function initializeAccount(){
    const epoch=authEpoch;$('retry-models').hidden=true;status();
    try{
      await refreshAccount();if(epoch!==authEpoch)return;
      await Promise.allSettled([loadModels(),loadHistory()]);
      if(epoch===authEpoch)await restoreConversation();
    }catch(error){
      if(error.status===401||error.name==='AbortError'||epoch!==authEpoch)return;
      $('model').replaceChildren(new Option('账户连接失败',''));$('retry-models').hidden=false;
      status(error.name==='TimeoutError'?'账户连接超时，请重试':error instanceof TypeError?'无法连接账户服务，请重试':error.status===404?'账户接口不可用，请重试':error.message,true);controls();
    }
  }
  function renderHistory(){
    $('history').replaceChildren();
    if(!historyRows.length){const p=document.createElement('div');p.className='history-empty';p.textContent=account?'从一句话开始吧':'登录后，留住每一次对话。';$('history').append(p);}
    for(const row of historyRows){
      const div=document.createElement('div');div.className='history-row'+(row.id===conversation?.id?' is-active':'');
      const open=document.createElement('button');open.type='button';open.className='history-open';open.textContent=row.title;open.title=row.title;open.addEventListener('click',()=>openConversation(row.id));
      const rename=document.createElement('button');rename.type='button';rename.className='history-rename';rename.dataset.id=row.id;rename.title='重命名';rename.setAttribute('aria-label','重命名 '+row.title);
      rename.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-12 12-6 1 1-6Z"/><path d="m14 5 5 5"/></svg>';
      rename.addEventListener('click',()=>{renameId=row.id;$('rename-input').value=row.title;$('rename-status').textContent='';$('rename-dialog').showModal();$('rename-input').select();});
      const remove=document.createElement('button');remove.type='button';remove.className='history-delete';remove.textContent='×';remove.setAttribute('aria-label','删除 '+row.title);remove.addEventListener('click',()=>deleteConversation(row.id));
      open.disabled=remove.disabled=rename.disabled=busy||loading;div.append(open,rename,remove);$('history').append(div);
    }
    $('more-history').hidden=!hasMore;
  }
  async function loadHistory(append=false){
    if(!account)return;
    const epoch=++historyEpoch,requestedTopic=topic;
    try{
      const data=await api(`/conversations?topic=${topic}&offset=${append?historyRows.length:0}`);
      if(epoch!==historyEpoch||requestedTopic!==topic)return;
      historyRows=append?[...historyRows,...data.conversations]:data.conversations;hasMore=data.hasMore;renderHistory();
    }catch(error){if(error.name!=='AbortError'&&epoch===historyEpoch)status(error.message,true);}
  }
  const mobileSidebar=matchMedia('(max-width:700px)');
  function setSidebar(open){
    $('sidebar').classList.toggle('is-open',open);
    document.querySelector('.chat-app').classList.toggle('sidebar-collapsed',!open);
    $('sidebar-toggle').setAttribute('aria-expanded',String(open));
    $('sidebar').inert=mobileSidebar.matches&&!open;
    $('sidebar-backdrop').hidden=!mobileSidebar.matches||!open;
  }
  function closeSidebar(){if(mobileSidebar.matches)setSidebar(false);}
  function render(){
    const config=topics[topic];document.querySelector('.chat-app').dataset.topic=topic;$('topic-name').textContent=config.name;$('welcome-title').textContent=config.title;$('mode-note').textContent=config.note;$('chat-input').placeholder=config.placeholder;
    document.querySelectorAll('button[data-topic]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.topic===topic)));
    const empty=messages.length===0&&!conversation?.context?.cards?.length;
    $('conversation-stage').classList.toggle('is-empty',empty);
    $('conversation-stage').classList.toggle('is-start',messages.length===0);
    if(!messages.length)$('jump-latest').hidden=true;
    $('welcome').hidden=!empty;$('suggestions').hidden=!empty;$('suggestions').replaceChildren();
    if(!$('chat-input').value)$('chat-input').style.height='';
    for(const text of config.suggestions){const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',()=>{$('chat-input').value=text;captureDraft();resizeInput();$('chat-input').focus();});$('suggestions').append(b);}
    $('tarot-cards').replaceChildren();const cards=conversation?.context?.cards||[];$('tarot-cards').hidden=!cards.length;
    for(const card of cards){
      const node=document.createElement('div');node.className='tarot-card';
      const position=document.createElement('span'),seal=document.createElement('div'),name=document.createElement('strong'),direction=document.createElement('span');
      position.className='tarot-position';position.textContent=card.position;
      seal.className='tarot-seal';seal.setAttribute('aria-hidden','true');
      name.textContent=card.name;direction.className='tarot-direction';direction.textContent=card.reversed?'逆位':'正位';
      node.append(position,seal,name,direction);$('tarot-cards').append(node);
    }
    $('messages').replaceChildren();for(const message of messages)appendMessage(message);renderAttachmentDraft();controls();renderHistory();
  }
  function appendMessage(message){
    const article=document.createElement('article');article.className='message message-'+message.role;
    const text=document.createElement('div');text.className='message-content';
    if(message.role==='assistant')BotGoUI.markdown(text,message.content||({running:'正在生成…',stopped:'已停止',failed:'请求未完成'}[message.state]||''));else text.textContent=message.content;
    if(message.kind==='image'&&message.state==='running'&&!message.content)text.textContent='正在绘制…';
    if(message.attachments?.length){
      const list=document.createElement('div');list.className='chat-attachments';
      list.append(...message.attachments.map((file,index)=>attachmentCard(file,index)));text.prepend(list);
    }
    for(const image of message.images||[]){
      if(!/^[a-zA-Z0-9_-]{16,128}$/.test(image.id||''))continue;
      const url='/api/chat/images/'+image.id,figure=document.createElement('figure'),preview=document.createElement('button'),img=document.createElement('img'),download=document.createElement('a'),unavailable=document.createElement('span');
      figure.className='generated-image';preview.type='button';preview.className='image-preview';preview.setAttribute('aria-label','查看生成的图片');img.src=url;img.alt='生成的图片';img.loading='lazy';
      unavailable.hidden=true;unavailable.textContent='图片暂不可用';
      img.addEventListener('error',()=>{preview.hidden=true;unavailable.hidden=false;download.hidden=true;});
      img.addEventListener('load',()=>{unavailable.hidden=true;});
      preview.addEventListener('click',()=>showImagePreview(url,'图片','生成的图片',url+'?download=1'));
      download.href=url+'?download=1';download.textContent='下载图片';download.download='BotGo-'+image.id+'.png';preview.append(img);figure.append(preview,unavailable,download);text.append(figure);
    }
    article.append(text);
    if(message.role==='assistant'){
      const tools=document.createElement('div');tools.className='message-tools';
      const copy=document.createElement('button');copy.type='button';copy.textContent='复制';copy.addEventListener('click',()=>BotGoUI.copyText(message.content,copy));
      const model=document.createElement('span');model.textContent=message.model||'';
      copy.hidden=!message.content;tools.append(copy,model);
      if(['failed','stopped','running'].includes(message.state)&&message===messages.findLast(row=>row.role==='assistant')){
        const recovery=document.createElement('button');recovery.type='button';recovery.className=message.state==='running'?'message-refresh':'message-retry';recovery.textContent=message.state==='running'?'刷新回答':'重试';
        recovery.title=message.state==='running'?'查看已保存的回答':'核对回答状态后，使用当前模型重新发送';recovery.addEventListener('click',()=>retryMessage(message));tools.append(recovery);
        if(message.content){const state=document.createElement('span');state.textContent=message.state==='stopped'?'已停止':message.state==='running'?'生成中':'未完成';tools.append(state);}
      }
      article.append(tools);
    }
    $('messages').append(article);return text;
  }
  async function openConversation(id){
    if(busy||loading)return false;
    captureDraft();
    loading=true;const epoch=++viewEpoch;controls();renderHistory();status();
    try{
      const data=await api('/conversations/'+id,{signal:AbortSignal.timeout(10000)});if(epoch!==viewEpoch)return false;
      resetAttachmentWork();conversation=data;topic=data.topic;messages=data.messages;$('draft-status').textContent='';saveLocation();restoreDraft();render();bottom();closeSidebar();return true;
    }catch(error){if(error.name!=='AbortError')status(error.name==='TimeoutError'?'对话加载超时，请重试':error.message,true);return false;}
    finally{if(epoch===viewEpoch){loading=false;controls();renderHistory();}}
  }
  async function deleteConversation(id){
    if(busy||loading||!confirm('删除这段对话？'))return;
    try{await api('/conversations/'+id,{method:'DELETE'});const key=JSON.stringify([account?.email||'',topic,id]);drafts.delete(key);attachmentDrafts.delete(key);persistDrafts();if(conversation?.id===id)resetView();await loadHistory();}
    catch(error){if(error.name!=='AbortError')status(error.message,true);}
  }
  async function createConversation(title){
    captureDraft();const key=draftKey(),created=await post('/conversations',{title,topic});
    const files=attachmentDrafts.get(key)||[];resetAttachmentWork();conversation=created;
    attachmentDrafts.delete(key);saveAttachmentDraft(draftKey(),files);
    drafts.delete(key);captureDraft();saveLocation();render();await loadHistory();
  }
  async function retryMessage(message){
    if(busy||loading||!conversation)return;
    const id=conversation.id,epoch=authEpoch;
    const original=messages.find(row=>row.role==='user'&&row.requestId===message.requestId);
    if(!await openConversation(id)||epoch!==authEpoch||conversation?.id!==id)return;
    const saved=messages.find(row=>row.role==='assistant'&&row.requestId===message.requestId);
    if(saved?.state==='completed'){
      if($('chat-input').value.trim()===original?.content){$('chat-input').value='';captureDraft();resizeInput();}
      if(draftAttachments()===original?.attachments){saveAttachmentDraft(draftKey(),[]);renderAttachmentDraft();controls();}
      status('回答已恢复');return;
    }
    if(saved?.state==='running'){status('回答仍在生成，请稍后刷新');return;}
    if(message.state==='running'){status('回答已更新');return;}
    const user=messages.find(row=>row.role==='user'&&row.requestId===message.requestId)||original;
    if(user?.content)await send({preventDefault(){}},{content:user.content,files:user.attachments||[],draftFiles:original?.attachments,retryRequestId:saved&&user.attachments?.length?saved.requestId:undefined});
  }
  async function consume(response,target,message,signal){
    let terminal=false,serverTurn=false,buffer='',eventLines=[];
    const decoder=new TextDecoder();
    function consumePayload(payload){
      signal.throwIfAborted();
      if(payload.type==='botgo.turn.started'){serverTurn=true;terminal=false;}
      if(payload.type==='botgo.turn.completed')terminal=true;
      if(payload.type==='botgo.image.failed')throw new Error(payload.error||'图片生成未完成');
      if(payload.error||['response.failed','response.incomplete'].includes(payload.type))throw new Error('上游未完成回答');
      if(payload.type==='botgo.image.generating'){terminal=false;message.kind='image';status('正在绘制…');}
      if(payload.type==='botgo.image.completed'){message.images=payload.images;message.model=payload.model;message.content=payload.content;terminal=true;status();}
      if(['response.web_search_call.in_progress','response.web_search_call.searching'].includes(payload.type))status('正在检索…');
      if(payload.type==='response.web_search_call.completed')status('正在整理资料…');
      const delta=payload.choices?.[0]?.delta?.content||(payload.type==='response.output_text.delta'?payload.delta:'');
      if(typeof delta==='string'&&delta){const follow=isNearBottom();message.content+=delta;target.textContent=message.content;if(follow)bottom();else $('jump-latest').hidden=false;}
      if(!serverTurn&&(payload.choices?.[0]?.finish_reason||payload.type==='response.completed'))terminal=true;
      if(payload.type==='response.completed'){message.content=BotGoUI.citedAnswer(message.content||payload.response?.output_text||payload.response?.output?.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('')||'',payload.response);status();}
    }
    function flush(){if(!eventLines.length)return;const data=eventLines.join('\n');eventLines=[];if(data==='[DONE]'){if(!serverTurn)terminal=true;return;}consumePayload(JSON.parse(data));}
    function line(text){if(text==='')flush();else if(text.startsWith('data:'))eventLines.push(text.slice(5).trimStart());}
    if(!response.headers.get('content-type')?.includes('text/event-stream')){
      const payload=await response.json();signal.throwIfAborted();
      if(payload.error||['failed','incomplete'].includes(payload.status))throw new Error('上游未完成回答');
      message.content=BotGoUI.citedAnswer(payload.choices?.[0]?.message?.content||payload.output_text||payload.output?.flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('')||'',payload);status();
      return;
    }
    const reader=response.body.getReader();
    try{
      for(;;){signal.throwIfAborted();const {done,value}=await reader.read();signal.throwIfAborted();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});let at;while((at=buffer.indexOf('\n'))>=0){line(buffer.slice(0,at).replace(/\r$/,''));buffer=buffer.slice(at+1);}if(buffer.length>2*1024*1024||message.content.length>4000000)throw new Error('回答过长');if(done)break;}
      if(buffer)line(buffer.replace(/\r$/,''));flush();
      if(!terminal)throw new Error('连接中断，回答未完成');
    }catch(error){await reader.cancel().catch(()=>{});throw error;}
    finally{reader.releaseLock();}
  }
  async function send(event,retry=null){
    event.preventDefault();if(busy||loading||attachmentJob)return;
    if(messages.some(row=>row.role==='assistant'&&row.state==='running')){status('回答仍在生成，请稍后刷新');return;}
    const files=retry?.files||draftAttachments(),inputBefore=$('chat-input').value;
    const content=(retry?.content??inputBefore).trim()||(files.length?attachmentPrompt:'');if(!content)return;
    if(!account){$('auth-dialog').showModal();return;}
    if(!$('model').value){status('请选择可用模型',true);return;}
    if((files.length||visualHistory())&&!supportsAttachments()){attachmentStatus(attachmentModelHint,true);return;}
    busy=true;controller=new AbortController();const signal=controller.signal,epoch=authEpoch,view=viewEpoch,model=$('model').value;
    status('');attachmentStatus();renderHistory();let message;
    try{
      if(!conversation)await createConversation(content);
      if(epoch!==authEpoch||view!==viewEpoch)return;
      signal.throwIfAborted();
      const requestId=crypto.randomUUID(),user={role:'user',content,requestId,attachments:files};
      messages.push(user);message={role:'assistant',content:'',requestId,model,state:'running'};messages.push(message);
      activeTurn={conversationId:conversation.id,requestId};
      if(!retry){if($('chat-input').value===inputBefore)$('chat-input').value='';saveAttachmentDraft(draftKey(),[]);}
      captureDraft();resizeInput();render();bottom();const target=$('messages').lastElementChild.querySelector('.message-content');
      const payload={conversationId:conversation.id,requestId,content,model};
      if(retry?.retryRequestId)payload.retryRequestId=retry.retryRequestId;else if(files.length)payload.attachments=files;
      const response=await fetch('/api/chat/stream',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal});
      if(epoch!==authEpoch||view!==viewEpoch){await response.body?.cancel();return;}
      if(!response.ok){
        const data=await response.json().catch(()=>({}));
        if(response.status===401){clearSession();throw new DOMException('Account changed','AbortError');}
        const error=new Error(data.error||'请求未完成');error.status=response.status;throw error;
      }
      target.textContent='';await consume(response,target,message,signal);signal.throwIfAborted();message.state='completed';
      user.attachments=files.map((file,index)=>({kind:file.kind,name:file.name,frameCount:file.frameCount??file.frames.length,url:`/api/chat/attachments/${requestId}/${index}`}));
      if(retry&&inputBefore.trim()===content&&$('chat-input').value===inputBefore){$('chat-input').value='';captureDraft();resizeInput();}
      if(retry?.draftFiles&&draftAttachments()===retry.draftFiles)saveAttachmentDraft(draftKey(),[]);
    }catch(error){
      if(message)message.state=error.name==='AbortError'?'stopped':'failed';
      if(epoch===authEpoch){
        if(error.name!=='AbortError'&&!retry){
          if(!$('chat-input').value){$('chat-input').value=inputBefore;captureDraft();resizeInput();}
          if(files.length&&!draftAttachments().length)saveAttachmentDraft(draftKey(),files);
        }
        status(error.name==='AbortError'?'已停止':error instanceof TypeError?'连接中断，请重试':error.message,error.name!=='AbortError',error.status===402);
      }
    }
    finally{
      if(stopping)await stopping;
      if(epoch===authEpoch&&view===viewEpoch){busy=false;controller=null;activeTurn=null;render();controls();if(signal.aborted&&conversation&&!messages.some(m=>m.state==='running'))await openConversation(conversation.id);await Promise.allSettled([refreshAccount(),loadHistory()]);}
    }
  }
  async function stopGeneration(){
    if(stopping)return;
    const running=messages.findLast(row=>row.role==='assistant'&&row.state==='running');
    const turn=activeTurn||(running&&conversation?{conversationId:conversation.id,requestId:running.requestId}:null);
    controller?.abort();
    if(!turn){status('已停止');return;}
    const epoch=authEpoch;
    stopping=(async()=>{
      try{
        status('正在停止…');
        const data=await api('/chat/cancel',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(turn),signal:AbortSignal.timeout(10000)});
        if(epoch!==authEpoch)return;
        if(running&&data.state==='stopped')running.state='stopped';
        status(data.state==='completed'?'回答已完成，正在恢复':'已停止');
      }catch(error){if(epoch===authEpoch){if(running)running.state='running';status('已停止接收，后台停止未确认，请重试停止',true);}}
      finally{stopping=null;if(epoch===authEpoch){if(!busy&&conversation?.id===turn.conversationId)await openConversation(turn.conversationId);render();controls();}}
    })();controls();await stopping;
  }
  document.querySelectorAll('button[data-topic]').forEach(b=>b.addEventListener('click',()=>{if(busy||loading||b.dataset.topic===topic)return;captureDraft();pendingConversation=null;topic=b.dataset.topic;historyRows=[];hasMore=false;resetView();status();loadHistory();closeSidebar();}));
  $('new-chat').addEventListener('click',()=>{if(busy||loading)return;captureDraft();pendingConversation=null;const key=JSON.stringify([account?.email||'',topic,'']);drafts.delete(key);attachmentDrafts.delete(key);resetView();persistDrafts();status();closeSidebar();$('chat-input').focus();});
  $('draw-cards').addEventListener('click',async()=>{
    if(!account){$('auth-dialog').showModal();return;}
    if(busy||loading||conversation)return;loading=true;controls();
    const epoch=viewEpoch;try{await createConversation('塔罗牌');}catch(error){if(error.name!=='AbortError')status(error.message,true);}finally{if(epoch===viewEpoch){loading=false;controls();renderHistory();}}
  });
  $('attach').addEventListener('click',()=>{if(canAddAttachments())$('chat-files').click();});
  $('chat-files').addEventListener('change',event=>{
    const files=[...event.target.files];event.target.value='';void addAttachments(files);
  });
  $('chat-form').addEventListener('dragover',event=>{
    if(!event.dataTransfer.types.includes('Files'))return;
    event.preventDefault();event.dataTransfer.dropEffect=$('attach').disabled?'none':'copy';
    $('chat-form').classList.toggle('is-dropping',!$('attach').disabled);
  });
  $('chat-form').addEventListener('dragleave',event=>{
    if(!event.relatedTarget||!$('chat-form').contains(event.relatedTarget))$('chat-form').classList.remove('is-dropping');
  });
  $('chat-form').addEventListener('drop',event=>{
    $('chat-form').classList.remove('is-dropping');
    if(!event.dataTransfer.files.length)return;
    event.preventDefault();void addAttachments([...event.dataTransfer.files]);
  });
  $('chat-input').addEventListener('paste',event=>{
    const clipboard=event.clipboardData;if(!clipboard?.files.length)return;
    if(!clipboard.getData('text/plain'))event.preventDefault();
    void addAttachments([...clipboard.files]);
  });
  $('chat-form').addEventListener('submit',send);
  $('chat-input').addEventListener('input',()=>{captureDraft();resizeInput();});
  $('chat-input').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('chat-form').requestSubmit();}});
  $('stop').addEventListener('click',stopGeneration);
  $('image-preview-close').addEventListener('click',()=>$('image-dialog').close());
  $('image-dialog').addEventListener('close',()=>{$('image-preview-full').removeAttribute('src');});
  $('model').addEventListener('change',()=>{try{localStorage.setItem('botgo-web-model',$('model').value);}catch{}if(attachmentNotice===attachmentModelHint)attachmentStatus();else controls();});
  $('retry-models').addEventListener('click',()=>account?loadModels():initializeAccount());$('refresh-history').addEventListener('click',()=>loadHistory());$('more-history').addEventListener('click',()=>loadHistory(true));
  $('sidebar-toggle').addEventListener('click',()=>{const open=$('sidebar-toggle').getAttribute('aria-expanded')!=='true';setSidebar(open);if(open&&mobileSidebar.matches)$('sidebar-close').focus();});
  function dismissSidebar(){setSidebar(false);$('sidebar-toggle').focus();}
  $('sidebar-close').addEventListener('click',dismissSidebar);
  $('sidebar-backdrop').addEventListener('click',dismissSidebar);
  mobileSidebar.addEventListener('change',()=>setSidebar(!mobileSidebar.matches));
  setSidebar(!mobileSidebar.matches);
  $('scroll-area').addEventListener('scroll',()=>{$('jump-latest').hidden=!messages.length||isNearBottom();});$('jump-latest').addEventListener('click',bottom);
  document.addEventListener('keydown',e=>{
    if(!mobileSidebar.matches||!$('sidebar').classList.contains('is-open')||$('auth-dialog').open||$('rename-dialog').open)return;
    if(e.key==='Escape'){dismissSidebar();return;}
    if(e.key==='Tab'){
      const focusable=[...$('sidebar').querySelectorAll('a,button')].filter(node=>!node.disabled&&node.getClientRects().length);
      const first=focusable[0],last=focusable.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  });
  $('account-button').addEventListener('click',()=>{if(account){window.location.href='./index.html?panel=account';}else{$('auth-dialog').showModal();$('email').focus();}});
  $('auth-close').addEventListener('click',()=>$('auth-dialog').close());
  function resetAuth(){verifying=false;$('email').readOnly=false;$('code-field').hidden=true;$('code').required=false;$('code').value='';$('auth-submit').textContent='发送验证码';$('auth-back').hidden=true;$('auth-status').textContent='';}
  $('auth-back').addEventListener('click',resetAuth);
  $('auth-form').addEventListener('submit',async e=>{
    e.preventDefault();$('auth-submit').disabled=true;$('auth-status').textContent='';
    try{
      const email=$('email').value.trim();
      if(!verifying){await post('/auth/request-login-code',{email});verifying=true;$('email').readOnly=true;$('code-field').hidden=false;$('code').required=true;$('auth-submit').textContent='登录';$('auth-back').hidden=false;$('code').focus();}
      else{
        const code=$('code').value.replace(/[０-９]/g,c=>String(c.charCodeAt(0)-0xff10));const data=await post('/auth/login',{email,code});
        const guestDraft=$('chat-input').value;drafts.delete(draftKey());authEpoch++;account=data.account;
        if(guestDraft&&!drafts.has(draftKey()))drafts.set(draftKey(),guestDraft);restoreDraft();persistDrafts();renderAccount();$('auth-dialog').close();resetAuth();
        await Promise.allSettled([loadModels(),loadHistory()]);await restoreConversation();controls();
      }
    }catch(error){if(error.name!=='AbortError')$('auth-status').textContent=error.message;}
    finally{$('auth-submit').disabled=false;}
  });
  $('logout').addEventListener('click',async()=>{try{await post('/auth/logout',{});pendingConversation=null;clearSession();logoutChannel?.postMessage('logout');status();}catch(error){status(error.message,true);}});
  logoutChannel?.addEventListener('message',e=>{if(e.data==='logout'||e.data?.type==='logout'){pendingConversation=null;clearDrafts();$('chat-input').value='';clearSession();}});
  $('rename-close').addEventListener('click',()=>$('rename-dialog').close());
  $('rename-dialog').addEventListener('close',()=>{const button=[...document.querySelectorAll('.history-rename')].find(node=>node.dataset.id===renameId);renameId=null;if(button&&!button.disabled)button.focus();});
  $('rename-form').addEventListener('submit',async event=>{
    event.preventDefault();if(busy||loading||!renameId)return;
    const id=renameId;$('rename-submit').disabled=true;$('rename-input').disabled=true;$('rename-status').textContent='';
    try{
      const data=await api('/conversations/'+id,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({title:$('rename-input').value}),signal:AbortSignal.timeout(10000)});
      if(conversation?.id===id)conversation.title=data.title;await loadHistory();$('rename-dialog').close();
    }catch(error){if(error.name!=='AbortError')$('rename-status').textContent=error.name==='TimeoutError'?'保存超时，请重试':error.message;}
    finally{$('rename-submit').disabled=false;$('rename-input').disabled=false;}
  });
  window.addEventListener('hashchange',async()=>{
    if(busy||loading){saveLocation();return;}
    captureDraft();
    const target=readLocation();topic=target?.[1]||'general';pendingConversation=target?.[2]||null;
    historyRows=[];hasMore=false;resetView();status();
    await loadHistory();await restoreConversation();
  });
  window.addEventListener('pagehide',()=>{captureDraft();persistDrafts();if(activeTurn)fetch('/api/chat/cancel',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify(activeTurn),keepalive:true}).catch(()=>{});controller?.abort();});
  render();restoreDraft();renderAccount();
  if(location.protocol==='file:')status('请通过 BotGo 站点打开，文件预览无法登录',true);else initializeAccount();
})();
