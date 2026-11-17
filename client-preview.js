(() => {
  const tabs = [...document.querySelectorAll('[data-client-preview]')];
  const panel = document.getElementById('client-preview-panel');
  if (!tabs.length || !panel) return;
  const image = panel.querySelector('img'), link = panel.querySelector('a');
  function select(tab) {
    for (const item of tabs) {
      item.setAttribute('aria-selected', String(item === tab));
      item.tabIndex = item === tab ? 0 : -1;
    }
    image.src = tab.dataset.clientPreview;
    image.alt = tab.dataset.previewAlt;
    link.href = tab.dataset.clientPreview;
    panel.setAttribute('aria-labelledby', tab.id);
  }
  for (const [index, tab] of tabs.entries()) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
      if (next === null) return;
      event.preventDefault(); select(tabs[next]); tabs[next].focus();
    });
  }
})();
