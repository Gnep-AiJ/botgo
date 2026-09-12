(() => {
  "use strict";

  const allowedViews = new Set(["chat", "agents", "tutorials"]);
  const params = new URLSearchParams(window.location.search);
  const localPreviewHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const accountPreview = localPreviewHost && ['account','chat'].includes(params.get('preview'));
  const openedFromLegacySubscription = params.get("view") === "subscription";
  const returnedOutTradeNo = params.get("out_trade_no") || "";
  let activeView = allowedViews.has(params.get("view")) ? params.get("view") : "chat";
  let account = null;
  let messages = [];
  let conversationId = null, historyAccount = null, historyEpoch = 0, historyRows = [], historyLoading = false, conversationLoading = false;
  let verificationPurpose = "register";

  const authDialog = document.getElementById("auth-dialog");
  const desktopInstallDialog = document.getElementById("desktop-install-dialog");
  const subscriptionDialog = document.getElementById("subscription-dialog");
  const authTitle = document.getElementById("auth-title");
  const authEyebrow = document.getElementById("auth-eyebrow");
  const loginForm = document.getElementById("login-form");
  const registerForm = document.getElementById("register-form");
  const verifyForm = document.getElementById("verify-form");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const chatLog = document.getElementById("chat-log");
  const welcomeView = document.getElementById("welcome-view");
  const composerNote = document.getElementById("composer-note");
  const themeToggle = document.getElementById("theme-toggle");
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  const prefersDarkTheme = window.matchMedia("(prefers-color-scheme: dark)");
  let savedThemePreference = null;
  let chatSending = false;
  let selectedModel='gpt-5.6-sol', availableModels=[], chatController=null;
  const modelPicker=document.getElementById('model-picker');
  const scrollArea=document.querySelector('.chat-column');
  const latestButton=document.createElement('button');latestButton.type='button';latestButton.className='jump-latest';latestButton.textContent='↓ 回到最新';latestButton.hidden=true;chatForm.before(latestButton);
  const nearBottom=()=>scrollArea.scrollHeight-scrollArea.scrollTop-scrollArea.clientHeight<100;
  latestButton.addEventListener('click',()=>{scrollArea.scrollTop=scrollArea.scrollHeight;latestButton.hidden=true;});
  scrollArea.addEventListener('scroll',()=>{latestButton.hidden=nearBottom();});
  BotGoUI.menu(modelPicker,()=>availableModels.map(m=>({value:m.id,label:m.name,selected:m.id===selectedModel,disabled:!m.enabled||!m.web})),id=>{selectedModel=id;modelPicker.textContent=`${availableModels.find(m=>m.id===id).name} ⌄`;try{localStorage.setItem('botgo-model',id)}catch{}},{label:'选择模型',up:true});
  const modelRetry=document.createElement('button');modelRetry.type='button';modelRetry.className='model-retry';modelRetry.textContent='重试';modelRetry.hidden=true;modelPicker.after(modelRetry);
  async function loadModels(){
    modelRetry.hidden=true;modelPicker.textContent='加载模型…';modelPicker.disabled=true;
    try{
      const data=accountPreview?{defaultModel:'gpt-5.6-sol',models:['gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.5','gpt-6-astra'].map(id=>({id,name:id.replace('gpt-','GPT-'),enabled:true,web:true}))}:await api('/models');
      if(!Array.isArray(data.models))throw new Error('Invalid model catalog');
      availableModels=data.models;
      let saved;try{saved=localStorage.getItem('botgo-model')}catch{}
      const usable=availableModels.filter(m=>m.enabled&&m.web);
      const selected=usable.find(m=>m.id===saved)||usable.find(m=>m.id===data.defaultModel)||usable[0];
      selectedModel=selected?.id||'';modelPicker.textContent=selected?`${selected.name} ⌄`:'暂无可用模型';
      modelPicker.disabled=!availableModels.length;modelRetry.hidden=!!selected;
    }catch{availableModels=[];selectedModel='';modelPicker.textContent='模型加载失败';modelPicker.disabled=true;modelRetry.hidden=false;}
  }
  modelRetry.addEventListener('click',loadModels);
  loadModels();
  document.getElementById('stop-chat').addEventListener('click',()=>chatController?.abort());
  function syncComposer(){chatInput.style.height='auto';chatInput.style.height=`${Math.min(168,chatInput.scrollHeight)}px`;chatForm.querySelector('[type=submit]').disabled=chatSending||!chatInput.value.trim();}
  chatInput.addEventListener('input',syncComposer);

  function currentTheme() {
    return document.documentElement.dataset.theme || (prefersDarkTheme.matches ? "dark" : "light");
  }

  function renderThemeToggle() {
    const nextTheme = currentTheme() === "dark" ? "light" : "dark";
    const themeLabel = `切换至${nextTheme === "dark" ? "夜间" : "日间"}模式`;
    themeToggle.setAttribute("aria-label", themeLabel);
    themeToggle.title = themeLabel;
    themeToggle.setAttribute("aria-pressed", String(currentTheme() === "dark"));
    themeColorMeta?.setAttribute("content", currentTheme() === "dark" ? "#06182b" : "#d7efff");
  }

  function applyTheme(theme) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    savedThemePreference = nextTheme;
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    try { localStorage.setItem("botgo-theme", nextTheme); } catch {}
    renderThemeToggle();
  }

  function syncThemeFromPreference() {
    const resolvedTheme = savedThemePreference || (prefersDarkTheme.matches ? "dark" : "light");
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    renderThemeToggle();
  }

  try {
    const savedTheme = localStorage.getItem("botgo-theme");
    if (savedTheme === "light" || savedTheme === "dark") {
      savedThemePreference = savedTheme;
    }
  } catch {}
  syncThemeFromPreference();
  async function loadDesktopRelease() {
    const releasePanel = document.getElementById("desktop-release");
    const loginButton = document.getElementById("desktop-download-login");
    const status = document.getElementById("desktop-install-status");
    releasePanel.hidden = true;
    loginButton.hidden = Boolean(account);
    if (!account) {
      status.textContent = "请先登录 BotGo 账号，再获取受保护的安装包。";
      return;
    }
    status.textContent = "正在获取最新版本…";
    try {
      const result = await api("/desktop/releases/current");
      if (!result.release) throw new Error("当前没有可下载的桌面版本。");
      const release = result.release;
      document.getElementById("desktop-download-link").href = release.downloadUrl;
      releasePanel.hidden = false;
      status.textContent = "安装包已准备好。";
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function openDesktopInstall() {
    if (!desktopInstallDialog.open) desktopInstallDialog.showModal();
    loadDesktopRelease();
  }

  function updateUrl() {
    const next = new URL(window.location.href);
    next.searchParams.set("view", activeView);
    next.searchParams.delete("agent");
    next.searchParams.delete("os");
    history.replaceState({ view: activeView }, "", next);
  }

  function setView(view, updateHistory) {
    activeView = allowedViews.has(view) ? view : "chat";
    document.body.dataset.activeView = activeView;
    document.querySelectorAll("[data-view]").forEach((section) => {
      section.hidden = section.dataset.view !== activeView;
    });
    document.querySelectorAll("[data-view-link]").forEach((button) => {
      button.setAttribute("aria-current", button.dataset.viewLink === activeView ? "page" : "false");
    });
    if (updateHistory) updateUrl();
  }

  function formatBalance(balanceCents) {
    const cents = Number(balanceCents);
    if (!Number.isFinite(cents)) return "—";
    return `￥${(Math.round(cents) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function renderAccountState() {
    const nextHistoryAccount=account?.id||account?.email||null;
    if(nextHistoryAccount!==historyAccount){
      historyAccount=nextHistoryAccount;historyEpoch++;historyLoading=false;conversationLoading=false;chatController?.abort();
      conversationId=null;messages=[];historyRows=[];chatLog.textContent='';welcomeView.hidden=false;renderHistory();
      if(account&&!accountPreview)loadHistory();
    }
    const accountButton = document.getElementById("account-button");
    const accountPopover = document.getElementById("account-popover");
    const accountMenu = document.getElementById("account-menu");
    const accountStatus = document.getElementById("account-status");
    const loginButton = document.getElementById("login-button");
    const registerButton = document.getElementById("register-button");
    const balanceCents = account ? Number(account.balanceCents ?? Math.round(Number(account.credits || 0) * 100)) : 0;
    const balance = account ? formatBalance(balanceCents) : "—";
    const summary = account ? `余额 ${balance}` : "登录后开始对话";
    composerNote.textContent = account ? "" : "登录后开始对话";
    document.getElementById('header-balance').hidden = !account;
    accountPopover.hidden = !account;
    loginButton.hidden = Boolean(account);
    registerButton.hidden = Boolean(account);
    if (account) {
      const avatar = (account.email || "账户").trim().charAt(0).toUpperCase();
      document.querySelectorAll("[data-account-avatar]").forEach((node) => { node.textContent = avatar; });
      document.querySelectorAll("[data-account-email]").forEach((node) => { node.textContent = account.email; });
      accountStatus.textContent = summary;
      setAccountMenu(false);
    } else {
      accountMenu.hidden = true;
      accountButton.setAttribute("aria-expanded", "false");
    }
    document.querySelectorAll("[data-billing-balance]").forEach((node) => { node.textContent = account ? balance : "—"; });
    document.querySelectorAll("[data-billing-account-state]").forEach((node) => { node.textContent = account ? "可用" : "未登录"; });
    document.querySelectorAll("[data-subscription-status]").forEach((node) => { node.textContent = account ? "余额可用于网页对话与桌面端任务。" : "登录后查看余额并充值。"; });
  }

  function setAccountMenu(open) {
    const accountMenu = document.getElementById("account-menu");
    const accountButton = document.getElementById("account-button");
    accountMenu.hidden = !open;
    accountButton.setAttribute("aria-expanded", String(open));
  }

  function openSubscriptionDialog() {
    setAccountMenu(false);
    if (!subscriptionDialog.open) subscriptionDialog.showModal();
  }

  async function reconcileReturnedOrder() {
    if (!returnedOutTradeNo) return;
    await api("/billing/query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outTradeNo: returnedOutTradeNo })
    });
  }

  function resetStatuses() {
    document.querySelectorAll(".form-status").forEach((node) => {
      node.textContent = "";
      node.className = "form-status";
    });
  }

  function showAuth(mode) {
    const isRegister = mode === "register";
    loginForm.hidden = isRegister;
    registerForm.hidden = !isRegister;
    verifyForm.hidden = true;
    authEyebrow.textContent = isRegister ? "BOTGO ACCOUNT / INVITE" : "BOTGO ACCOUNT";
    authTitle.textContent = isRegister ? "创建 BotGo 账户" : "登录 BotGo";
    document.querySelectorAll(".auth-mode-switch [data-auth-mode]").forEach((button) => {
      button.setAttribute("aria-current", button.dataset.authMode === mode ? "page" : "false");
    });
    resetStatuses();
    if (!authDialog.open) authDialog.showModal();
    window.requestAnimationFrame(() => {
      const firstInput = (isRegister ? registerForm : loginForm).querySelector("input");
      if (firstInput) firstInput.focus();
    });
  }

  function showVerification(email, purpose) {
    verificationPurpose = purpose;
    loginForm.hidden = true;
    registerForm.hidden = true;
    verifyForm.hidden = false;
    authEyebrow.textContent = "BOTGO ACCOUNT / VERIFY";
    authTitle.textContent = purpose === "login" ? "登录验证码" : "验证你的邮箱";
    verifyForm.elements.email.value = email;
    verifyForm.elements.code.focus();
  }

  function setStatus(id, message, isError) {
    const target = document.getElementById(id);
    target.textContent = message;
    target.className = `form-status${isError ? " is-error" : " is-success"}`;
  }

  async function api(path, options) {
    const response = await fetch(`/api${path}`, { credentials: "same-origin", ...options });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {const error=new Error(body.error || "请求未完成，请稍后重试。");error.status=response.status;if(response.status===401){account=null;renderAccountState();}throw error;}
    return body;
  }

  function appendMessage(role, content, modifier) {
    const message = document.createElement("article");
    message.className = `chat-message chat-message--${modifier || role}`;
    const body=document.createElement('div');body.className='message-body';body.textContent=content;message.append(body);
    const follow=nearBottom();chatLog.appendChild(message);
    if(follow)scrollArea.scrollTop=scrollArea.scrollHeight;
    return body;
  }

  function resetConversation() {
    if(chatSending||conversationLoading){historyStatus('请先停止生成或等待对话加载完成。');return;}
    conversationId=null;
    messages = [];
    chatLog.textContent = "";
    welcomeView.hidden = false;
    setView("chat", true);
    chatInput.focus();
    historyDialog.close();renderHistory();
  }

  const historyDialog=document.createElement('dialog');historyDialog.className='history-dialog';
  historyDialog.innerHTML='<div class="history-dialog-heading"><strong>历史对话</strong><button type="button" aria-label="关闭历史对话">关闭</button></div><button type="button" class="mobile-new-chat">新建对话</button><div class="mobile-history-list"></div><p class="mobile-history-status" role="status"></p><button type="button" class="mobile-history-retry" hidden>重试</button><button type="button" class="mobile-history-more" hidden>加载更多</button>';
  document.body.append(historyDialog);
  historyDialog.querySelector('.history-dialog-heading button').onclick=()=>historyDialog.close();
  historyDialog.querySelector('.mobile-new-chat').onclick=resetConversation;
  const historyOpen=document.createElement('button');historyOpen.type='button';historyOpen.className='history-open';historyOpen.textContent='历史对话';
  historyOpen.onclick=()=>{historyDialog.showModal();if(account&&!accountPreview)loadHistory();};
  document.querySelector('.workspace-view--chat').prepend(historyOpen);
  const deleteDialog=document.createElement('dialog');deleteDialog.className='history-dialog';
  deleteDialog.innerHTML='<h2>删除这段对话？</h2><p>删除后无法恢复。</p><div class="history-delete-actions"><button type="button" data-cancel>取消</button><button type="button" data-confirm>删除</button></div><p role="status"></p>';
  document.body.append(deleteDialog);
  deleteDialog.querySelector('[data-cancel]').onclick=()=>deleteDialog.close();
  function historyStatus(text){document.getElementById('history-status').textContent=text;historyDialog.querySelector('.mobile-history-status').textContent=text;}
  function historyControls(retry,more){document.getElementById('history-retry').hidden=!retry;document.getElementById('history-more').hidden=!more;historyDialog.querySelector('.mobile-history-retry').hidden=!retry;historyDialog.querySelector('.mobile-history-more').hidden=!more;}
  function renderHistory(){
    for(const list of [document.getElementById('history-list'),historyDialog.querySelector('.mobile-history-list')]){
      list.replaceChildren();
      for(const row of historyRows){
        const item=document.createElement('div');item.className='history-row';
        const open=document.createElement('button');open.type='button';open.className='history-title';open.textContent=row.title;open.title=row.title;open.setAttribute('aria-current',String(row.id===conversationId));open.onclick=()=>openConversation(row.id);
        const remove=document.createElement('button');remove.type='button';remove.className='history-delete';remove.textContent='×';remove.setAttribute('aria-label',`删除对话：${row.title}`);remove.onclick=()=>confirmDelete(row);
        item.append(open,remove);list.append(item);
      }
    }
    historyStatus(account?(historyRows.length?'':'暂无历史对话'):'登录后查看历史对话');
    if(!account)historyControls(false,false);
  }
  async function loadHistory(more=false){
    if(!account||accountPreview||historyLoading)return;
    const epoch=historyEpoch;historyLoading=true;historyStatus('正在加载…');historyControls(false,false);
    try{const data=await api(`/conversations?offset=${more?historyRows.length:0}`);if(epoch!==historyEpoch)return;
      historyRows=more?[...historyRows,...data.conversations.filter(row=>!historyRows.some(old=>old.id===row.id))]:data.conversations;renderHistory();historyControls(false,data.hasMore);
    }catch(error){if(epoch===historyEpoch){historyStatus(error.message);historyControls(true,false);}}
    finally{if(epoch===historyEpoch)historyLoading=false;}
  }
  async function openConversation(id){
    if(chatSending||conversationLoading){historyStatus('请先停止生成或等待对话加载完成。');return;}
    const epoch=historyEpoch;conversationLoading=true;historyStatus('正在打开…');
    try{const data=await api(`/conversations/${id}`);if(epoch!==historyEpoch)return;
      conversationId=id;messages=data.messages;chatLog.replaceChildren();welcomeView.hidden=messages.length>0;
      for(const message of messages){const node=appendMessage(message.role,message.content);if(message.role==='assistant'){
        BotGoUI.markdown(node,message.content||({running:'正在生成，请稍后重新打开',stopped:'已停止',failed:'请求未完成'}[message.state]||'没有返回内容'));
        const detail=document.createElement('div');detail.className='message-tools';detail.textContent=[message.model,({running:'生成中',stopped:'已停止',failed:'未完成'}[message.state])].filter(Boolean).join(' · ');
        if(message.content){const copy=document.createElement('button');copy.type='button';copy.textContent='复制';copy.onclick=()=>BotGoUI.copyText(message.content,copy);detail.append(copy);}node.after(detail);
      }}
      setView('chat',true);historyDialog.close();renderHistory();scrollArea.scrollTop=scrollArea.scrollHeight;
    }catch(error){if(epoch===historyEpoch)historyStatus(error.message);}
    finally{if(epoch===historyEpoch)conversationLoading=false;}
  }
  function confirmDelete(row){
    if(chatSending||conversationLoading){historyStatus('请先停止生成或等待对话加载完成，再删除。');return;}
    const epoch=historyEpoch;deleteDialog.querySelector('h2').textContent=`删除“${row.title}”？`;deleteDialog.querySelector('[role=status]').textContent='';deleteDialog.showModal();
    const button=deleteDialog.querySelector('[data-confirm]');button.onclick=async()=>{
      button.disabled=true;
      try{await api(`/conversations/${row.id}`,{method:'DELETE'});if(epoch!==historyEpoch)return;
        if(conversationId===row.id)resetConversation();historyRows=historyRows.filter(item=>item.id!==row.id);renderHistory();deleteDialog.close();loadHistory();
      }catch(error){deleteDialog.querySelector('[role=status]').textContent=error.message;}finally{button.disabled=false;}
    };
  }
  document.getElementById('history-retry').onclick=()=>loadHistory();
  document.getElementById('history-more').onclick=()=>loadHistory(true);
  historyDialog.querySelector('.mobile-history-retry').onclick=()=>loadHistory();
  historyDialog.querySelector('.mobile-history-more').onclick=()=>loadHistory(true);

  async function consumeStream(response, target) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let answer = "";
    const applyEvent = (data) => {
      if (!data || data === "[DONE]") return;
      try {
        const payload = JSON.parse(data);
        const delta = payload.choices?.[0]?.delta?.content;
        if (delta) { const follow=nearBottom();answer += delta;target.textContent = answer;if(follow)scrollArea.scrollTop=scrollArea.scrollHeight;else latestButton.hidden=false; }
      } catch { /* 忽略上游 SSE 保活事件。 */ }
    };
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      lines.forEach((line) => { if (line.startsWith("data:")) applyEvent(line.slice(5).trim()); });
      if (done) break;
    }
    if (buffer.startsWith("data:")) applyEvent(buffer.slice(5).trim());
    return answer;
  }

  async function submitChat(event) {
    event.preventDefault();
    if (chatSending || conversationLoading) return;
    const content = chatInput.value.trim();
    if (!content) return;
    if (!account) { showAuth("login"); return; }
    if (!availableModels.some(m=>m.id===selectedModel&&m.enabled&&m.web)) { modelRetry.hidden=false;modelPicker.textContent='请重试加载模型';return; }
    welcomeView.hidden = true;
    chatInput.value = "";
    const requestIndex=messages.length;
    const requestEpoch=historyEpoch;
    messages.push({ role: "user", content });
    appendMessage("user", content);
    const responseNode = appendMessage("assistant", "正在连接模型…");
    const sendButton = chatForm.querySelector('[type="submit"]');
    chatSending = true;
    sendButton.disabled = true;
    sendButton.setAttribute("aria-busy", "true");
    const requestModel=selectedModel;modelPicker.disabled=true;sendButton.hidden=true;document.getElementById('stop-chat').hidden=false;chatController=new AbortController();syncComposer();
    const finishMessage=(answer)=>{BotGoUI.markdown(responseNode,answer);const tools=document.createElement('div');tools.className='message-tools';const copy=document.createElement('button');copy.type='button';copy.className='message-copy';copy.textContent='复制';copy.addEventListener('click',()=>BotGoUI.copyText(answer,copy));const model=document.createElement('span');model.className='message-model';model.textContent=requestModel;tools.append(copy,model);responseNode.after(tools);};
    try {
      if(accountPreview){const answer='这是本地对话预览。\n\n**模型和菜单**可以直接体验，不会发起真实请求。\n\n```powershell\nbotgo\n```';finishMessage(answer);messages.push({role:'assistant',content:answer,model:requestModel});return;}
      const epoch=historyEpoch;
      if(!conversationId){const created=await api('/conversations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:content})});if(epoch!==historyEpoch)return;conversationId=created.id;}
      if(chatController.signal.aborted)throw new DOMException('Stopped','AbortError');
      const response = await fetch("/api/chat/stream", {
        method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        signal:chatController.signal,
        body: JSON.stringify({ model: requestModel, conversationId, requestId:crypto.randomUUID(), content })
      });
      if (!response.ok || !response.body) {
        const body = await response.json().catch(() => ({}));
        if(response.status===401){account=null;renderAccountState();}
        throw new Error(body.error || "对话请求未完成。");
      }
      const answer = await consumeStream(response, responseNode);
      if(requestEpoch!==historyEpoch)return;
      if (answer) {messages.push({ role: "assistant", content: answer, model:requestModel });finishMessage(answer);}
      else responseNode.textContent = "模型没有返回内容，请重试。";
    } catch (error) {
      if(requestEpoch!==historyEpoch)return;
      if(error.name==='AbortError'){const partial=responseNode.textContent;if(partial&&partial!=='正在连接模型…'){messages.push({role:'assistant',content:partial,model:requestModel});finishMessage(partial);}else responseNode.textContent='已停止';}
      else {responseNode.textContent=error.message;const retry=document.createElement('button');retry.type='button';retry.className='message-retry';retry.textContent='重试';retry.addEventListener('click',()=>{if(chatSending)return;if(messages.length!==requestIndex+1){chatInput.value=content;syncComposer();chatInput.focus();return;}messages.pop();responseNode.parentElement.previousElementSibling?.remove();responseNode.parentElement.remove();chatInput.value=content;syncComposer();chatForm.requestSubmit();});responseNode.after(retry);}
    } finally {
      chatSending = false;
      sendButton.disabled = false;
      sendButton.removeAttribute("aria-busy");
      sendButton.hidden=false;document.getElementById('stop-chat').hidden=true;modelPicker.disabled=false;chatController=null;syncComposer();window.dispatchEvent(new Event('botgo:account-refresh'));
      chatInput.focus();
      if(account&&!accountPreview)loadHistory();
    }
  }

  document.querySelectorAll("[data-view-link]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.viewLink, true)));
  document.querySelectorAll("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => showAuth(button.dataset.authMode)));
  document.querySelectorAll("[data-desktop-open]").forEach((button) => button.addEventListener("click", openDesktopInstall));
  themeToggle.addEventListener("click", () => applyTheme(currentTheme() === "dark" ? "light" : "dark"));
  prefersDarkTheme.addEventListener("change", () => {
    if (!savedThemePreference) syncThemeFromPreference();
  });
  document.getElementById("desktop-install-close").addEventListener("click", () => desktopInstallDialog.close());
  document.getElementById("desktop-download-login").addEventListener("click", () => {
    desktopInstallDialog.close();
    showAuth("login");
  });
  document.getElementById("auth-close").addEventListener("click", () => authDialog.close());
  document.getElementById("subscription-close").addEventListener("click", () => subscriptionDialog.close());
  subscriptionDialog.addEventListener("close", () => {
    const accountButton = document.getElementById("account-button");
    if (account && !document.getElementById("account-popover").hidden) accountButton.focus();
  });
  document.getElementById("new-chat-button").addEventListener("click", resetConversation);
  document.getElementById("account-button").addEventListener("click", () => {
    const accountMenu = document.getElementById("account-menu");
    setAccountMenu(accountMenu.hidden);
  });
  document.querySelectorAll("[data-open-subscription]").forEach(button => button.addEventListener("click", () => {
    openSubscriptionDialog();
  }));
  document.addEventListener("click", (event) => {
    const accountPopover = document.getElementById("account-popover");
    const accountMenu = document.getElementById("account-menu");
    if (!accountMenu.hidden && !accountPopover.contains(event.target)) setAccountMenu(false);
  });
  document.addEventListener("keydown", (event) => {
    const accountMenu = document.getElementById("account-menu");
    if (event.key === "Escape" && !accountMenu.hidden) {
      setAccountMenu(false);
      document.getElementById("account-button").focus();
    }
  });
  chatForm.addEventListener("submit", submitChat);
  chatInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    chatForm.requestSubmit();
  });
  window.addEventListener("popstate", () => {
    const next = new URLSearchParams(window.location.search);
    const openedFromLegacySubscription = next.get("view") === "subscription";
    setView(allowedViews.has(next.get("view")) ? next.get("view") : "chat", false);
    if (openedFromLegacySubscription) openSubscriptionDialog();
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault(); setStatus("login-status", "正在发送验证码…", false);
    const data = Object.fromEntries(new FormData(loginForm));
    try { await api("/auth/request-login-code", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(data) }); showVerification(data.email, "login"); setStatus("verify-status", "验证码已发送，请检查邮箱。", false); }
    catch (error) { setStatus("login-status", error.message, true); }
  });
  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault(); setStatus("register-status", "正在发送验证码…", false); const data = Object.fromEntries(new FormData(registerForm));
    try { await api("/auth/redeem-invite", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(data) }); showVerification(data.email, "register"); setStatus("verify-status", "验证码已发送，请检查邮箱。", false); }
    catch (error) { setStatus("register-status", error.message, true); }
  });
  verifyForm.addEventListener("submit", async (event) => {
    event.preventDefault(); setStatus("verify-status", "正在验证邮箱…", false);
    const data = Object.fromEntries(new FormData(verifyForm));
    data.code = String(data.code || "").trim().replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xfee0));
    try { const result = await api(verificationPurpose === "login" ? "/auth/login" : "/auth/verify-email", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify(data) }); account = result.account; renderAccountState(); authDialog.close(); }
    catch (error) { setStatus("verify-status", error.message, true); }
  });

  setView(activeView, true);
  if (accountPreview) {
    account = { email: "preview@botgo.local", balanceCents: 102000 };
    renderAccountState();
    if(params.get('preview')==='account')openSubscriptionDialog();
  } else if (openedFromLegacySubscription) {
    openSubscriptionDialog();
  }
  async function refreshAccount() {
    if (accountPreview) return;
    try {
      if (returnedOutTradeNo) await reconcileReturnedOrder();
      const result = await api("/account");
      account = result.account;
      renderAccountState();
    } catch (error) {
      if(error.status===401)account=null;
      renderAccountState();
    }
  }
  window.addEventListener("botgo:account-refresh", refreshAccount);
  refreshAccount();
})();
