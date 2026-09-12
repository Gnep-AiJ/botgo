(() => {
  const button = document.querySelector('[data-copy-install]');
  const status = document.querySelector('[data-install-status]');
  button?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText('irm https://botgo.win/install.ps1 | iex');
      status.textContent = '已复制，粘贴到 PowerShell 中运行。';
    } catch { status.textContent = '请选中上方命令并复制。'; }
  });
})();
document.querySelectorAll('[data-guide]').forEach(button=>{
  button.id=`guide-tab-${button.dataset.guide}`;
  button.setAttribute('aria-controls',`guide-panel-${button.dataset.guide}`);
  const panel=document.querySelector(`[data-guide-panel="${button.dataset.guide}"]`);
  panel.id=`guide-panel-${button.dataset.guide}`;panel.setAttribute('aria-labelledby',button.id);
  button.addEventListener('click',()=>{
    document.querySelectorAll('[data-guide]').forEach(b=>{b.setAttribute('aria-selected',String(b===button));b.tabIndex=b===button?0:-1;});
    document.querySelectorAll('[data-guide-panel]').forEach(panel=>panel.hidden=panel.dataset.guidePanel!==button.dataset.guide);
    const url=new URL(location.href);url.searchParams.set('guide',button.dataset.guide);history.replaceState(null,'',url);
  });
  button.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=[...document.querySelectorAll('[data-guide]')];const i=tabs.indexOf(button);const next=event.key==='Home'?tabs[0]:event.key==='End'?tabs.at(-1):tabs[(i+(event.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length];next.click();next.focus();});
});
const initialGuide=new URLSearchParams(location.search).get('guide')||'web';
document.querySelector(`[data-guide="${['web','account','cli','faq'].includes(initialGuide)?initialGuide:'web'}"]`)?.click();

document.querySelector('[data-copy-project]')?.addEventListener('click', async event => {
  const text = event.currentTarget.previousElementSibling.textContent;
  const status = document.querySelector('[data-install-status]');
  try { await navigator.clipboard.writeText(text); status.textContent = '已复制目录示例，请替换为已有项目路径后运行。'; }
  catch { status.textContent = '复制失败，请选中目录示例手动复制。'; }
});
