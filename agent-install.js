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
