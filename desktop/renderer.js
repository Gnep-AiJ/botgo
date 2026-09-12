const ui={projectPath:"",threadId:"",mode:"workspace-write",account:null,history:{selectedProject:"",selectedThreadId:"",recentProjects:[],threads:[]},runningThread:""};
const $=(selector)=>document.querySelector(selector);const $$=(selector)=>[...document.querySelectorAll(selector)];
const escapeHtml=(value)=>String(value).replace(/[&<>'"]/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[character]);
const projectName=(projectPath)=>projectPath.split(/[\\/]/).filter(Boolean).pop()||projectPath;
const currentThread=()=>ui.history.threads.find((thread)=>thread.id===ui.threadId)||null;
let submitting=false,modelsReady=false,authorizing=false;
let terminalStarting=false,terminalState='idle';
function renderRunningState(){
 const node=$('[data-running-state]');
 const state=terminalStarting||submitting?'starting':ui.runningThread||terminalState==='running'?'running':terminalState==='error'||currentThread()?.status==='error'?'error':'idle';
 node.dataset.state=state;node.textContent=({starting:'启动中',running:terminalState==='running'?'终端运行中':'执行中',error:'运行失败',idle:'就绪'})[state];
}
function syncControls(){
 const busy=submitting||Boolean(ui.runningThread)||terminalStarting||terminalState==='running';
 renderRunningState();
 $$('[data-new-thread],[data-change-project],[data-empty-choose-project],[data-thread-id],[data-thread-menu],[data-open-terminal]').forEach(button=>button.disabled=busy);
 $('[data-start-task]').disabled=busy||!modelsReady||!$('[data-task-prompt]').value.trim();
 $('[data-start-task]').hidden=Boolean(ui.runningThread);$('[data-stop-task]').hidden=!ui.runningThread;
 $('[data-task-prompt]').disabled=busy;$('[data-model]').disabled=busy||!modelsReady;$('[data-mode]').disabled=busy;
 for(const selector of ['[data-model]','[data-mode]']){const select=$(selector);if(select.previousElementSibling?.classList.contains('model-picker'))select.previousElementSibling.disabled=select.disabled;}
}
function setMessage(value,error=false){const node=$("[data-workspace-message]");node.textContent=value||"";node.style.color=error?"var(--danger)":""}
function accountMessage(value,error=false){const node=$("[data-account-message]");node.textContent=value||"";node.style.color=error?"var(--danger)":""}

function renderAccount(){
 const signed=Boolean(ui.account);const initials=signed?ui.account.email.slice(0,2).toUpperCase():"BG";
 const cents=ui.account?.balanceCents;const yuan=Number.isFinite(cents)?cents/100:Number(ui.account?.credits);
 const balance=Number.isFinite(yuan)?new Intl.NumberFormat("zh-CN",{style:"currency",currency:"CNY"}).format(yuan):"—";
 $("[data-account-guest]").hidden=signed;$("[data-account-signed]").hidden=!signed;
 $("[data-account-menu-title]").textContent=signed?"账户":"登录 BotGo";
 $("[data-account-name]").textContent=signed?ui.account.email:"登录 BotGo";
 $("[data-account-state]").textContent=signed?`余额 ${balance}`:"连接你的账户";
 $("[data-account-avatar]").textContent=initials;$(".account-summary-avatar").textContent=initials;
 $("[data-account-email]").textContent=signed?ui.account.email:"—";$("[data-account-credits]").textContent=balance;
}
function openAccount(notice=""){$("[data-account-menu]").hidden=false;positionAccount();$("[data-account-trigger]").setAttribute("aria-expanded","true");if(notice)accountMessage(notice);$("[data-account-menu-title]").focus()}
function positionAccount(){const menu=$('[data-account-menu]');if(menu.hidden)return;const anchor=$('[data-account-trigger]').getBoundingClientRect();menu.style.width=`${Math.min(anchor.width,innerWidth-24)}px`;menu.style.left=`${Math.max(12,Math.min(anchor.left,innerWidth-menu.offsetWidth-12))}px`;menu.style.bottom=`${Math.max(12,innerHeight-anchor.top+8)}px`;menu.style.maxHeight=`${Math.max(120,anchor.top-20)}px`;}
window.addEventListener('resize',positionAccount);
document.addEventListener('pointerdown',event=>{if(!$('[data-account-menu]').hidden&&!event.target.closest('.sidebar-account'))closeAccount();});
function closeAccount(){$("[data-account-menu]").hidden=true;$("[data-account-trigger]").setAttribute("aria-expanded","false");accountMessage("");$("[data-account-trigger]").focus()}
async function refreshAccount(){const result=await window.botgo.account();ui.account=result.account;renderAccount();return result.account}

function projectLabel(project){
 const name=projectName(project);
 return ui.history.recentProjects.filter(item=>projectName(item)===name).length>1?project:name;
}
function renderProjects(){
 const container=$('[data-project-list]');
 container.innerHTML=ui.history.threads.map(thread=>`<div class="thread-row${thread.id===ui.threadId?' active':''}"><button class="thread-item" type="button" data-thread-id="${escapeHtml(thread.id)}" title="${escapeHtml(thread.title)} — ${escapeHtml(thread.projectPath)}" ${thread.id===ui.threadId?'aria-current="true"':''}><span>${escapeHtml(thread.title||'新对话')}</span>${['running','error'].includes(thread.status)?`<i class="thread-state ${thread.status}" aria-label="${thread.status==='running'?'执行中':'执行失败'}"></i>`:''}</button><button class="thread-more" type="button" data-thread-menu="${escapeHtml(thread.id)}" aria-label="${escapeHtml(thread.title)}的操作" aria-haspopup="menu" aria-expanded="false">⋯</button></div>`).join('')||'<p class="empty-copy">暂无对话</p>';
 $$('[data-thread-id]').forEach(button=>button.onclick=()=>selectThread(button.dataset.threadId).catch(error=>setMessage(error.message,true)));
 $$('[data-thread-menu]').forEach(button=>button.onclick=()=>openThreadMenu(button));
}
let menuAnchor=null,editAction=null;
function closeMenus(restore=false){
 $('[data-context-menu]').hidden=true;$('[data-project-menu]').hidden=true;
 $('[data-change-project]').setAttribute('aria-expanded','false');
 menuAnchor?.setAttribute('aria-expanded','false');if(restore)menuAnchor?.focus();
}
function placeMenu(menu,anchor){
 const rect=anchor.getBoundingClientRect();menu.hidden=false;
 menu.style.left=`${Math.max(8,Math.min(rect.left,innerWidth-menu.offsetWidth-8))}px`;
 menu.style.top=`${Math.max(8,Math.min(rect.bottom+6,innerHeight-menu.offsetHeight-8))}px`;
}
function openThreadMenu(button){
 const wasOpen=menuAnchor===button&&!$('[data-context-menu]').hidden;closeMenus();if(wasOpen)return;
 menuAnchor=button;button.setAttribute('aria-expanded','true');
 const menu=$('[data-context-menu]'),id=button.dataset.threadMenu;
 menu.innerHTML='<button type="button" role="menuitem" data-rename>重命名</button><button type="button" role="menuitem" class="danger" data-delete>删除对话</button>';
 menu.querySelector('[data-rename]').onclick=()=>editThread(id,false);
 menu.querySelector('[data-delete]').onclick=()=>editThread(id,true);
 placeMenu(menu,button);menu.querySelector('button').focus();
}
function beginEdit({title,description,value,action,destructive=false}){
 if(submitting||ui.runningThread)return setMessage('请先停止当前任务。',true);
 closeMenus();editAction=action;
 $('[data-edit-title]').textContent=title;$('[data-edit-description]').textContent=description;
 $('[data-edit-label]').hidden=value===undefined;$('[data-edit-input]').value=value||'';
 $('[data-edit-error]').textContent='';$('[data-edit-confirm]').textContent=destructive?'删除':'保存';
 $('[data-edit-confirm]').classList.toggle('destructive',destructive);
 $('[data-edit-dialog]').showModal();(destructive?$('[data-edit-cancel]'):$('[data-edit-input]')).focus();
 if(!destructive)$('[data-edit-input]').select();
}
function editThread(id,remove){
 const thread=ui.history.threads.find(item=>item.id===id);if(!thread)return;
 beginEdit({title:remove?'删除对话？':'重命名对话',description:remove?`“${thread.title}”将从 BotGo 本地记录中删除，无法撤销。`: '',value:remove?undefined:thread.title,destructive:remove,action:()=>remove?window.botgo.deleteThread(id):window.botgo.renameThread(id,$('[data-edit-input]').value)});
}
function openProjects(){
 const menu=$('[data-project-menu]'),wasOpen=!menu.hidden;closeMenus();if(wasOpen)return;
 menuAnchor=$('[data-change-project]');menuAnchor.setAttribute('aria-expanded','true');
 $('[data-project-options]').innerHTML=ui.history.recentProjects.map(project=>`<div class="project-option"><button type="button" data-select-project="${escapeHtml(project)}" title="${escapeHtml(project)}" ${project===ui.projectPath?'aria-current="true"':''}>${escapeHtml(projectLabel(project))}</button><button class="project-remove" type="button" data-remove-project="${escapeHtml(project)}" aria-label="从 BotGo 删除 ${escapeHtml(project)}" title="从 BotGo 删除">×</button></div>`).join('');
 $$('[data-select-project]').forEach(button=>button.onclick=async()=>{closeMenus();try{const project=button.dataset.selectProject;const thread=ui.history.threads.find(item=>item.projectPath===project);if(thread)await selectThread(thread.id);else{await window.botgo.rememberProject(project);await refreshHistory();}}catch(error){setMessage(error.message,true)}});
 $$('[data-remove-project]').forEach(button=>button.onclick=()=>{const project=button.dataset.removeProject;beginEdit({title:'从 BotGo 删除项目？',description:`${project} 的本地对话记录将一并删除，无法撤销。磁盘上的项目文件保持不变。`,destructive:true,action:()=>window.botgo.removeProject(project)});});
 placeMenu(menu,menuAnchor);menu.querySelector('button')?.focus();
}
$('[data-edit-cancel]').onclick=()=>{$('[data-edit-dialog]').close();menuAnchor?.focus()};
$('[data-edit-form]').onsubmit=async event=>{
 event.preventDefault();if(!editAction)return;const button=$('[data-edit-confirm]');button.disabled=true;
 try{await editAction();$('[data-edit-dialog]').close();await refreshHistory();$('[data-task-prompt]').focus();}
 catch(error){$('[data-edit-error]').textContent=error.message;}
 finally{button.disabled=false;}
};
$('[data-add-project]').onclick=()=>{closeMenus();chooseProject().catch(error=>setMessage(error.message,true))};
document.addEventListener('pointerdown',event=>{if(!event.target.closest('[data-context-menu],[data-project-menu],[data-thread-menu],[data-change-project]'))closeMenus()});
document.addEventListener('keydown',event=>{
 if(event.key==='Escape')closeMenus(true);
 const menu=!$('[data-context-menu]').hidden?$('[data-context-menu]'):!$('[data-project-menu]').hidden?$('[data-project-menu]'):null;
 if(!menu)return;
 if(event.key==='Tab'){closeMenus();return;}
 if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
 event.preventDefault();const buttons=[...menu.querySelectorAll('button:not(:disabled)')],index=buttons.indexOf(document.activeElement);
 buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();
});
window.addEventListener('resize',()=>closeMenus());
let lastRenderedThread="";
function renderConversation(){const follow=lastRenderedThread!==ui.threadId||$("[data-conversation]").scrollHeight-$("[data-conversation]").scrollTop-$("[data-conversation]").clientHeight<100;const previousTop=$("[data-conversation]").scrollTop;lastRenderedThread=ui.threadId;const thread=currentThread();const conversation=$("[data-conversation]");$("[data-thread-title]").textContent=thread?.title||"新对话";$("[data-running-state]").textContent=ui.runningThread?(ui.runningThread===ui.threadId?"执行中":"其他对话执行中"):"就绪";if(!thread||!thread.messages.length){const hasProject=Boolean(ui.projectPath);const projectLabel=escapeHtml(projectName(ui.projectPath));conversation.innerHTML=hasProject?`<div class="conversation-empty project-ready" data-conversation-empty><h1>今天想做什么？</h1><p>在 ${projectLabel} 中描述任务，开始工作。</p></div>`:'<div class="conversation-empty" data-conversation-empty><h1>从你的项目开始</h1><p>选择文件夹，开始对话。</p><button class="primary" type="button" data-empty-choose-project>选择文件夹</button></div>';$("[data-empty-choose-project]")?.addEventListener("click",chooseProject);return}conversation.innerHTML=thread.messages.map((message)=>`<article class="message ${escapeHtml(message.role)}"><span class="message-avatar">${message.role==="user"?"你":message.role==="assistant"?"BG":"i"}</span><div class="message-body">${escapeHtml(message.content)}${message.files?.length?`<details class="file-changes"><summary>查看 ${message.files.length} 个文件改动</summary>${message.files.map((file)=>`<span class="file-chip">${escapeHtml(file)}</span>`).join("")}</details>`:""}</div></article>`).join("");conversation.querySelectorAll('article.message').forEach((article,index)=>{const message=thread.messages[index];if(message.role!=='assistant')return;const body=article.querySelector('.message-body');const files=body.querySelector('.file-changes');window.BotGoUI.markdown(body,message.content);if(files)body.append(files);const controls=document.createElement('div');controls.className='message-tools';const copy=document.createElement('button');copy.type='button';copy.textContent='复制';copy.addEventListener('click',()=>window.BotGoUI.copyText(message.content,copy));const model=document.createElement('span');model.textContent=message.model||'';controls.append(copy,model);body.append(controls);});conversation.scrollTop=follow?conversation.scrollHeight:previousTop}
function render(){const selected=Boolean(ui.projectPath);$("[data-current-project]").textContent=selected?projectLabel(ui.projectPath):"选择文件夹";$("[data-current-project-path]").textContent=selected?ui.projectPath:"打开本地项目";$('[data-change-project]').title=ui.projectPath||'选择文件夹';$("[data-change-project]").hidden=!selected;renderProjects();renderConversation();syncControls()}
async function refreshHistory(){ui.history=await window.botgo.history();ui.projectPath=ui.history.selectedProject||ui.history.recentProjects[0]||"";ui.threadId=ui.history.selectedThreadId||ui.history.threads.find((thread)=>thread.projectPath===ui.projectPath)?.id||"";render()}
async function selectThread(id){if(ui.runningThread&&ui.runningThread!==id)return setMessage("当前对话正在执行，停止后再切换。",true);ui.history=await window.botgo.selectThread(id);ui.threadId=id;ui.projectPath=currentThread()?.projectPath||ui.history.selectedProject;setMessage("");render()}
async function newThread(projectPath=ui.projectPath){if(ui.runningThread)return setMessage("当前对话正在执行，停止后再新建。",true);if(!projectPath)return chooseProject();ui.history=await window.botgo.createThread(projectPath);ui.projectPath=projectPath;ui.threadId=ui.history.selectedThreadId;setMessage("");render();$("[data-task-prompt]").focus()}
async function chooseProject(){const project=await window.botgo.chooseProject();if(!project)return;ui.projectPath=project;ui.history=await window.botgo.rememberProject(project);await newThread(project)}
function setRunning(running){if(!running)submitting=false;syncControls()}
async function prepareAfterLogin(){await window.botgo.prepare(false)}
async function completeLogin(account){ui.account={...account,plan:account.plan||""};renderAccount();try{accountMessage("正在准备本地环境…");await prepareAfterLogin();await refreshAccount();closeAccount()}catch(error){accountMessage(error.message||"本地环境尚未准备完成。",true)}}

$("[data-account-trigger]").addEventListener("click",()=>$("[data-account-menu]").hidden?openAccount():closeAccount());$("[data-account-close]").addEventListener("click",closeAccount);document.addEventListener("keydown",(event)=>{if(event.key==="Escape"&&!$("[data-account-menu]").hidden)closeAccount()});
$("[data-start-web-authorization]").addEventListener("click",async()=>{if(authorizing)return;authorizing=true;$('[data-start-web-authorization]').disabled=true;try{accountMessage("正在打开浏览器…");await window.botgo.startWebAuthorization();$("[data-cancel-web-authorization]").hidden=false;accountMessage("请在浏览器中完成登录并确认这台设备。")}catch(error){authorizing=false;$('[data-start-web-authorization]').disabled=false;accountMessage(error.message||"无法开始浏览器授权。",true)}});$("[data-cancel-web-authorization]").addEventListener("click",()=>window.botgo.cancelWebAuthorization().catch(error=>accountMessage(error.message,true)));
$('[data-change-project]').setAttribute('aria-haspopup','true');$('[data-change-project]').onclick=openProjects;$$('[data-choose-project]').forEach((button)=>button.addEventListener("click",()=>chooseProject().catch((error)=>setMessage(error.message,true))));$("[data-new-thread]").addEventListener("click",()=>newThread());
$("[data-composer]").addEventListener("submit",async(event)=>{
 event.preventDefault();if(submitting||ui.runningThread)return;
 const prompt=$('[data-task-prompt]').value.trim();if(!prompt)return;
 if(!modelsReady)return setMessage('请选择可用模型，或重新加载模型列表。',true);
 if(!ui.projectPath)return chooseProject();if(!ui.account)return openAccount("登录后即可在当前文件夹执行。");
 const mode=$('[data-mode]').value,model=modelSelect.value;
 const confirmedFullAccess=mode!=='full-access'||confirm('完全访问可能处理当前项目以外的内容，确认继续？');if(!confirmedFullAccess)return;
 submitting=true;syncControls();setMessage('正在准备任务…');let accepted=false;
 try{if(!ui.threadId)await newThread(ui.projectPath);await prepareAfterLogin();ui.runningThread=ui.threadId;syncControls();const result=await window.botgo.startTask({threadId:ui.threadId,projectPath:ui.projectPath,prompt,mode,model,confirmedFullAccess});accepted=true;ui.threadId=result.id;$('[data-task-prompt]').value='';$('[data-task-prompt]').style.height='auto';await refreshHistory();}
 catch(error){if(!accepted)ui.runningThread='';setMessage(error.message||'无法开始执行。',true);}
 finally{submitting=false;syncControls();}
});
$("[data-task-prompt]").addEventListener("keydown",(event)=>{if(event.key!=="Enter"||event.shiftKey||event.isComposing)return;event.preventDefault();$("[data-composer]").requestSubmit()});$("[data-task-prompt]").addEventListener("input",(event)=>{event.currentTarget.style.height="auto";event.currentTarget.style.height=`${Math.min(180,event.currentTarget.scrollHeight)}px`;syncControls()});
$("[data-stop-task]").addEventListener("click",async()=>{const button=$('[data-stop-task]');button.disabled=true;setMessage('正在停止…');try{await window.botgo.stopTask()}catch(error){setMessage(error.message||'无法停止任务，请重试。',true)}finally{button.disabled=false}});$("[data-open-account]").addEventListener("click",()=>window.botgo.openAccountPage().catch(error=>accountMessage(error.message,true)));$("[data-revoke-device]").addEventListener("click",async()=>{if(!confirm("退出这台设备？"))return;try{await window.botgo.revokeDevice();location.reload()}catch(error){accountMessage(error.message,true)}});
window.botgo.onTaskEvent((event)=>{if(event.type==="started")setMessage("BotGo 正在处理…");if(["progress","files","session"].includes(event.type))refreshHistory().catch(()=>{});if(["completed","stopped","error"].includes(event.type)){ui.runningThread="";setRunning(false);setMessage(event.type==="completed"?"":event.message||"执行未完成。",event.type==="error");refreshHistory().catch(()=>{});refreshAccount().catch(()=>{})}});
window.botgo.onAuthorizationEvent((event)=>{if(event.type==="waiting"){$("[data-cancel-web-authorization]").hidden=false;accountMessage("请在浏览器中完成登录并确认这台设备。");return}authorizing=false;$('[data-start-web-authorization]').disabled=false;$("[data-cancel-web-authorization]").hidden=true;if(event.type==="completed")completeLogin(event.account);else accountMessage(event.message||"浏览器授权未完成。",event.type!=="cancelled")});
const modelSelect=$('[data-model]');
window.BotGoUI.enhanceSelect(modelSelect);
window.BotGoUI.enhanceSelect($('[data-mode]'));
async function loadModels(){modelsReady=false;$('[data-model-retry]').hidden=true;syncControls();try{const result=await window.botgo.models();if(!Array.isArray(result.models))throw Error('Invalid models');modelSelect.replaceChildren(...result.models.map(m=>{const option=document.createElement('option');option.value=m.id;option.textContent=m.name;option.disabled=!(m.enabled&&m.agent);return option;}));let saved;try{saved=localStorage.getItem('botgo-model')}catch{}const usable=result.models.filter(m=>m.enabled&&m.agent);modelSelect.value=(usable.find(m=>m.id===saved)||usable.find(m=>m.id===result.defaultModel)||usable[0])?.id||'';modelsReady=usable.length>0;if(!modelsReady)setMessage('暂无可用模型，请稍后重试。',true);else setMessage('');modelSelect.dispatchEvent(new Event('change'));}catch{setMessage('模型列表加载失败，请检查网络后重试。',true);}finally{$('[data-model-retry]').hidden=modelsReady;syncControls();}}
$('[data-model-retry]').onclick=loadModels;
modelSelect.addEventListener('change',()=>{try{if(modelSelect.value)localStorage.setItem('botgo-model',modelSelect.value)}catch{}});
renderAccount();refreshHistory().catch(error=>{render();setMessage(error.message,true)});refreshAccount().catch(renderAccount);loadModels();

$("[data-open-terminal]").addEventListener("click",async()=>{
 if(terminalStarting||terminalState==='running')return;
 if(!ui.projectPath)return chooseProject();if(!ui.account)return openAccount('登录后打开终端。');
 if(ui.runningThread||submitting)return setMessage('停止当前任务后再打开终端。',true);
 terminalStarting=true;terminalState='starting';const button=$('[data-open-terminal]');button.setAttribute('aria-busy','true');button.textContent='正在打开…';syncControls();
 try{const result=await window.botgo.openTerminal({projectPath:ui.projectPath,model:modelSelect.value,sessionId:currentThread()?.sessionId||''});if(!result?.consoleReady)throw Error('终端未确认交互输入输出。');terminalState='running';setMessage('交互控制台已连接，请在终端中操作。');}
 catch(error){terminalState='error';setMessage(error.message,true);}
 finally{terminalStarting=false;button.removeAttribute('aria-busy');button.textContent='在终端中打开 ↗';syncControls();}
});
window.botgo.onTerminalEvent?.(event=>{terminalState=event.state;setMessage(event.message,event.state==='error');syncControls();});
document.addEventListener("keydown",(event)=>{if(event.key!=="Tab"||$("[data-account-menu]").hidden)return;const nodes=[...$("[data-account-menu]").querySelectorAll('button:not([hidden]),summary')].filter(n=>n.getClientRects().length);const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===$("[data-account-menu-title]"))){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}});
