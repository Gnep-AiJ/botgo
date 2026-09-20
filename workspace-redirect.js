(() => {
  const source = new URLSearchParams(location.search);
  const target = new URL('./index.html', location.href);
  target.searchParams.set('panel', source.get('open') === 'recharge' || source.get('view') === 'subscription' ? 'recharge' : 'account');
  for (const key of ['next', 'out_trade_no', 'auth']) {
    if (source.has(key)) target.searchParams.set(key, source.get(key));
  }
  location.replace(target.href);
})();
