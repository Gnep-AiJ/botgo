/* Shared browser/Electron interaction primitives. No credentials or network access. */
(() => {
  let opened=null;
  function menu(trigger,items,onSelect,{label='选择',up=false}={}) {
    const panel=document.createElement('div');panel.className='botgo-menu';panel.hidden=true;
    panel.setAttribute('role','menu');panel.setAttribute('aria-label',label);panel.id=`menu-${crypto.randomUUID()}`;
    document.body.append(panel);trigger.setAttribute('aria-haspopup','menu');trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-expanded','false');
    function position(){const r=trigger.getBoundingClientRect(),w=Math.min(280,innerWidth-24);panel.style.width=`${w}px`;const h=Math.min(panel.scrollHeight,innerHeight-24),below=innerHeight-r.bottom,above=(up&&r.top>=h)||(below<h&&r.top>below);panel.style.maxHeight=`${Math.max(0,(above?r.top:below)-16)}px`;panel.style.left=`${Math.max(12,Math.min(r.left,innerWidth-w-12))}px`;panel.style.top=above?'auto':`${r.bottom+8}px`;panel.style.bottom=above?`${innerHeight-r.top+8}px`:'auto';}
    function close(restore=false){panel.hidden=true;trigger.setAttribute('aria-expanded','false');if(opened===api)opened=null;if(restore)trigger.focus();}
    function open(){if(trigger.disabled)return;opened?.close();panel.replaceChildren();for(const item of (typeof items==='function'?items():items)){const b=document.createElement('button');b.type='button';b.setAttribute('role','menuitemradio');b.setAttribute('aria-checked',String(!!item.selected));b.disabled=!!item.disabled;b.textContent=item.label;const mark=document.createElement('span');mark.textContent=item.disabled?'暂不可用':item.selected?'✓':'';b.append(mark);b.addEventListener('click',()=>{onSelect(item.value);close(true)});panel.append(b);}panel.hidden=false;trigger.setAttribute('aria-expanded','true');opened=api;position();(panel.querySelector('[aria-checked="true"]:not(:disabled)')||panel.querySelector('button:not(:disabled)'))?.focus();}
    const api={close,open,panel};trigger.addEventListener('click',()=>panel.hidden?open():close(true));
    trigger.addEventListener('keydown',e=>{if(['ArrowDown','ArrowUp'].includes(e.key)){e.preventDefault();open();}});
    panel.addEventListener('keydown',e=>{const buttons=[...panel.querySelectorAll('button:not(:disabled)')];let i=buttons.indexOf(document.activeElement);if(e.key==='Escape'){e.preventDefault();close(true);}else if(e.key==='Tab')close();else if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();i=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowUp'?-1:1)+buttons.length)%buttons.length;buttons[i]?.focus();}});
    document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!panel.contains(e.target)&&!trigger.contains(e.target))close();});
    window.addEventListener('resize',()=>{if(!panel.hidden)position()});window.addEventListener('scroll',()=>{if(!panel.hidden)position()},true);
    return api;
  }
  function enhanceSelect(select,{up=true}={}) {
    const button=document.createElement('button');button.type='button';button.className='model-picker';select.before(button);select.hidden=true;
    const sync=()=>{button.textContent=`${select.selectedOptions[0]?.textContent||'选择'} ⌄`;button.disabled=select.disabled;};
    menu(button,()=>[...select.options].map(o=>({value:o.value,label:o.textContent,selected:o.selected,disabled:o.disabled})),v=>{select.value=v;select.dispatchEvent(new Event('change',{bubbles:true}));sync()},{label:select.getAttribute('aria-label')||'选择',up});
    select.addEventListener('change',sync);new MutationObserver(sync).observe(select,{attributes:true,childList:true,subtree:true});sync();return button;
  }
  function inline(text,parent) {
    const tokens=String(text).split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
    for(const token of tokens){let node;if(token.startsWith('`')&&token.endsWith('`')){node=document.createElement('code');node.textContent=token.slice(1,-1);}else if(token.startsWith('**')&&token.endsWith('**')){node=document.createElement('strong');node.textContent=token.slice(2,-2);}else node=document.createTextNode(token);parent.append(node);}
  }
  function markdown(target,text) {
    target.replaceChildren();const parts=String(text).split(/```([^\n`]*)\n([\s\S]*?)(?:```|$)/g);
    for(let i=0;i<parts.length;i++){if(i%3===1){const pre=document.createElement('pre'),code=document.createElement('code'),bar=document.createElement('div'),copy=document.createElement('button');bar.className='code-bar';bar.textContent=parts[i]||'代码';copy.type='button';copy.textContent='复制代码';const content=parts[++i];copy.addEventListener('click',()=>copyText(content,copy));bar.append(copy);code.textContent=content;pre.append(bar,code);target.append(pre);continue;}if(i%3===2)continue;let list=null;for(const line of parts[i].split('\n')){const item=line.match(/^\s*(?:[-*]|\d+\.)\s+(.+)/);if(item){if(!list){list=document.createElement('ul');target.append(list);}const li=document.createElement('li');inline(item[1],li);list.append(li);}else{list=null;if(!line.trim())continue;const heading=line.match(/^(#{1,3})\s+(.+)/);const p=document.createElement(heading?`h${heading[1].length+1}`:'p');inline(heading?heading[2]:line,p);target.append(p);}}}
  }
  async function copyText(text,button){try{await navigator.clipboard.writeText(text);const old=button.textContent;button.textContent='已复制';setTimeout(()=>button.textContent=old,1400);}catch{button.textContent='复制失败';}}
  window.BotGoUI={menu,enhanceSelect,markdown,copyText};
})();
