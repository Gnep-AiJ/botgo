(() => {
  'use strict';
  let pending = false;
  async function startDownload(button, redirectForLogin = true) {
    if (pending) return;
    pending = true;
    const oldContent = button?.innerHTML;
    if (button) { button.setAttribute('aria-busy', 'true'); button.textContent = '正在获取安装包…'; }
    try {
      const response = await fetch('/api/desktop/releases/current', { credentials: 'same-origin' });
      if (response.status === 401) {
        if (redirectForLogin) window.botgoAccount?.open('account', { next: 'download' });
        return;
      }
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || '暂时无法获取安装包');
      if (!body.release?.downloadUrl) throw new Error('当前没有可下载的版本');
      const url = new URL(body.release.downloadUrl, location.origin);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('下载地址无效');
      location.assign(url.href);
    } catch (error) {
      const status = document.getElementById('download-status');
      if (status) status.textContent = error.message || '暂时无法获取安装包';
    } finally {
      pending = false;
      if (button) { button.removeAttribute('aria-busy'); button.innerHTML = oldContent; }
    }
  }
  document.querySelectorAll('[data-download]').forEach(button => button.addEventListener('click', event => {
    event.preventDefault();
    startDownload(button);
  }));
  window.botgoDownload = startDownload;
})();
