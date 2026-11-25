(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const money = cents => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: 'CNY' }).format(cents / 100);
  const orderStates = { paid: '待发货', purchasing: '采购中', delivered: '已发货', refunded: '已退回余额' };
  const cardStates = {
    valid: '卡密可用，请前往兑换页。',
    processing: '兑换处理中，正在更新卡密状态…',
    used: '卡密已使用。订阅是否开通请在兑换页核对。',
    disabled: '卡密已停用。',
    expired: '卡密已过期。',
    invalid: '卡密无效，请检查后重试。',
  };
  const checkoutDialog = $('checkout-dialog');
  const ordersDialog = $('orders-dialog');
  const policyDialog = $('policy-dialog');
  const manageDialog = $('manage-dialog');
  const brandMark = document.querySelector('.shop-hero-title .shop-brand-mark');
  const pendingActions = new Map();
  let checkout = null, wallet = null, walletStatus = 'loading';
  let ordersRead = 0, checkRead = 0, cardRead = 0, manageRead = 0;
  let checkTimer, checkedCode = '', leftForPortal = false, adminAction = null, adminBusy = false;

  async function api(path, data) {
    const response = await fetch('/api' + path, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(18_000),
      ...(data === undefined ? {} : {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(data),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || '请求暂未完成，请稍后重试。');
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function message(id, content, error = false) {
    const output = $(id);
    output.textContent = content;
    output.hidden = !content;
    output.dataset.error = String(error);
  }

  function element(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text) item.textContent = text;
    return item;
  }

  function button(text, handler, style = 'secondary') {
    const item = element('button', 'shop-button shop-button--' + style, text);
    item.type = 'button';
    item.addEventListener('click', handler);
    return item;
  }

  function productCard(product) {
    const card = element('article', 'shop-product');
    card.dataset.plan = product.tier;
    const header = element('div', 'shop-product-heading');
    const mark = brandMark.cloneNode(true);
    mark.classList.add('shop-plan-mark');
    const inStock = product.stock > 0;
    const inventory = element('span', 'shop-stock', inStock ? '有货' : product.stock === 0 ? '缺货' : '库存待确认');
    inventory.dataset.available = String(inStock);
    header.append(mark, inventory);
    const footer = element('div', 'shop-product-foot');
    const amount = element('strong', 'shop-price', product.priceCents === null ? '待定价' : money(product.priceCents));
    amount.dataset.unset = String(product.priceCents === null);
    const buy = button(product.available ? '购买' : '暂不可购', () => openCheckout(product), 'primary');
    buy.setAttribute('aria-label', '购买 ' + product.name + (product.priceCents === null ? '' : ' ' + money(product.priceCents)));
    buy.disabled = !product.available;
    footer.append(amount, buy);
    card.append(header, element('h3', '', product.name), element('p', '', '1 个月'), footer);
    return card;
  }

  async function loadCatalog() {
    $('catalog-retry').hidden = true;
    message('catalog-status', '正在加载商品…');
    try {
      const { products } = await api('/shop/catalog');
      $('product-list').replaceChildren(...products.map(productCard));
      message('catalog-status', products.length ? '' : '当前没有可展示的套餐。');
    } catch (error) {
      $('catalog-retry').hidden = error.status === 404;
      message('catalog-status', error.status === 404 ? '商城暂未开放。' : '商品暂未加载，请重试。', true);
    }
  }

  function orderRow(order, admin = false) {
    const row = element('li', 'shop-order-row');
    const details = element('div', 'shop-order-details');
    const time = String(order.createdAt).replace(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}).*$/, '$1 $2 UTC');
    details.append(element('strong', '', order.productName), element('small', '', (admin ? order.email + ' · ' : '') + time));
    if (admin && order.supplierOrder) details.append(element('small', '', '上游单号 ' + order.supplierOrder));
    const state = element('span', 'shop-order-state', orderStates[order.state]);
    state.dataset.state = order.state;
    row.append(details, state, element('strong', 'shop-order-amount', money(order.amountCents)));
    if (!admin && order.state === 'delivered') row.append(button('查看卡密', event => revealCard(order.id, event.currentTarget)));
    return row;
  }

  function renderOrders() {
    const ready = walletStatus === 'ready';
    const login = walletStatus === 'guest';
    const orders = ready ? wallet.orders : [];
    $('shop-account').textContent = ready ? '余额 ' + money(wallet.availableCents) : '登录 / 注册';
    $('order-login').hidden = !login;
    $('refresh-orders').hidden = login || walletStatus === 'loading';
    $('manage-orders').hidden = !wallet?.canManage;
    $('order-rows').replaceChildren(...orders.map(order => orderRow(order)));
    $('order-rows').hidden = !orders.length;
    if (login) message('orders-status', '登录 BotGo 后查看订单。');
    else if (ready) message('orders-status', orders.length ? '' : '暂无订单。');
    else if (walletStatus === 'error') message('orders-status', '订单暂未加载，请刷新。', true);
    updateCheckout();
  }

  async function loadOrders() {
    const read = ++ordersRead;
    try {
      const data = await api('/shop/orders');
      if (read !== ordersRead) return;
      wallet = data;
      walletStatus = 'ready';
    } catch (error) {
      if (read !== ordersRead) return;
      wallet = null;
      walletStatus = error.status === 401 ? 'guest' : 'error';
    }
    renderOrders();
  }

  function updateCheckout() {
    if (!checkout) return;
    const ready = walletStatus === 'ready';
    const insufficient = ready && (wallet.availableCents < checkout.product.priceCents || checkout.needsFunds);
    const canContinue = ready && !insufficient && !checkout.complete && !checkout.pending;
    $('checkout-balance').textContent = ready ? '可用 ' + money(wallet.availableCents) : '';
    $('checkout-continue').hidden = checkout.complete || insufficient || walletStatus === 'guest';
    $('checkout-continue').disabled = !canContinue;
    $('checkout-recharge').hidden = checkout.complete || !insufficient;
    $('checkout-login').hidden = checkout.complete || walletStatus !== 'guest';
    $('checkout-orders').hidden = !checkout.complete;
    $('policy-pay').disabled = !canContinue;
    $('policy-pay').textContent = checkout.pending ? '正在支付…' : '同意并支付 ' + money(checkout.product.priceCents);
    for (const button of policyDialog.querySelectorAll('[data-close]')) button.disabled = checkout.pending;
  }

  function openCheckout(product) {
    checkout = { product, pending: false, complete: false, needsFunds: false };
    $('checkout-product').textContent = product.name;
    $('checkout-price').textContent = money(product.priceCents);
    message('checkout-status', '');
    updateCheckout();
    checkoutDialog.showModal();
    loadOrders();
  }

  function openOrders() {
    ordersDialog.showModal();
    loadOrders();
  }

  function openPolicy(review = false) {
    $('policy-read').hidden = review;
    $('policy-review').hidden = !review;
    message('policy-status', '');
    updateCheckout();
    policyDialog.showModal();
    policyDialog.scrollTop = 0;
  }

  function actionKey(product) {
    return 'botgo-shop-action:' + product.id + ':' + product.priceCents;
  }

  function retryId(selection) {
    if (selection.actionId) return selection.actionId;
    const key = actionKey(selection.product);
    let id = pendingActions.get(key) || crypto.randomUUID();
    try {
      id = sessionStorage.getItem(key) || id;
      sessionStorage.setItem(key, id);
    } catch {}
    pendingActions.set(key, id);
    selection.actionId = id;
    return id;
  }

  $('checkout-form').addEventListener('submit', event => {
    event.preventDefault();
    if (checkout && !$('checkout-continue').disabled) openPolicy(true);
  });

  $('policy-pay').addEventListener('click', async () => {
    if (!checkout || !policyDialog.open || $('policy-review').hidden || $('policy-pay').disabled) return;
    const selection = checkout;
    selection.pending = true;
    updateCheckout();
    message('policy-status', '');
    message('checkout-status', '');
    try {
      const { product } = selection;
      const { order } = await api('/shop/orders', {
        productId: product.id, amountCents: product.priceCents, actionId: retryId(selection), accepted: true,
      });
      const key = actionKey(product);
      if (pendingActions.get(key) === selection.actionId) pendingActions.delete(key);
      try {
        if (sessionStorage.getItem(key) === selection.actionId) sessionStorage.removeItem(key);
      } catch {}
      selection.complete = true;
      if (checkout === selection) {
        policyDialog.close();
        message('checkout-status', order.state === 'paid' ? '已付款，等待发货。' : '订单已确认。');
      }
    } catch (error) {
      if (checkout === selection) {
        selection.needsFunds = error.status === 402;
        if (error.status === 401 || selection.needsFunds) {
          policyDialog.close();
          message('checkout-status', error.message, true);
        } else {
          message('policy-status', error.status && error.status < 500 ? error.message : '付款结果待确认，请查看订单或重试原操作。', true);
        }
      }
    } finally {
      selection.pending = false;
      await loadOrders();
      updateCheckout();
    }
  });

  policyDialog.addEventListener('cancel', event => {
    if (checkout?.pending) event.preventDefault();
  });

  async function revealCard(id, trigger) {
    const read = ++cardRead;
    trigger.disabled = true;
    try {
      const { code } = await api('/shop/orders/' + id + '/card');
      if (read !== cardRead) return;
      $('delivery-code').textContent = code;
      message('delivery-status', '');
      $('delivery-dialog').showModal();
    } catch (error) {
      if (read === cardRead) message('orders-status', error.message, true);
    } finally {
      trigger.disabled = false;
    }
  }

  function stopCheck() {
    checkRead++;
    clearTimeout(checkTimer);
    $('card-form').querySelector('button').disabled = false;
  }

  async function readCard(code, pass = 0) {
    clearTimeout(checkTimer);
    const read = ++checkRead;
    const submit = $('card-form').querySelector('button');
    submit.disabled = true;
    if (!pass) message('card-status', '正在核验…');
    try {
      const { status } = await api('/shop/cards/check', { code });
      if (read !== checkRead) return;
      checkedCode = code;
      const canPoll = status === 'processing' && pass < 5;
      let content = cardStates[status];
      if (status === 'processing' && !canPoll) content = '仍在处理中，稍后可再次核验。';
      if (status === 'valid' && /^ZC-/i.test(code)) content = '旧版卡密可用，请按发卡时提供的入口兑换。';
      message('card-status', content, ['disabled', 'expired', 'invalid'].includes(status));
      if (canPoll) checkTimer = setTimeout(() => readCard(code, pass + 1), 10_000);
    } catch (error) {
      if (read !== checkRead) return;
      message('card-status', error.status === 401 ? '请先登录 BotGo，再核验卡密。' : error.message, true);
    } finally {
      if (read === checkRead) submit.disabled = false;
    }
  }

  function resetManageForm() {
    adminAction = null;
    $('manage-form').reset();
    $('manage-form').hidden = true;
  }

  function prepareManage(order, action) {
    adminAction = { id: order.id, action };
    $('manage-form').reset();
    $('manage-form-title').textContent = (action === 'refund' ? '退回 ' + money(order.amountCents) + ' 至 BotGo 余额？' : '为 ' + order.productName + ' 发货');
    $('manage-fields').hidden = action !== 'deliver';
    $('supplier-order').required = $('supplier-card').required = action === 'deliver';
    $('manage-submit').textContent = action === 'refund' ? '确认退款' : '确认发货';
    $('manage-form').hidden = false;
    (action === 'refund' ? $('manage-submit') : $('supplier-order')).focus();
  }

  function manageRow(order) {
    const row = orderRow(order, true);
    if (order.state === 'paid') row.append(button('认领', event => manageOrder({ id: order.id, action: 'claim' }, {}, event.currentTarget)));
    if (order.state === 'purchasing' && order.assignedToMe) row.append(button('发货', () => prepareManage(order, 'deliver')));
    if (order.state === 'paid' || (order.state === 'purchasing' && order.assignedToMe)) {
      row.append(button('退款', () => prepareManage(order, 'refund'), 'quiet'));
    }
    return row;
  }

  async function loadManage(ok = '') {
    const read = ++manageRead;
    message('manage-status', '正在读取订单…');
    try {
      const { orders } = await api('/admin/shop/orders');
      if (read !== manageRead || !manageDialog.open) return;
      $('manage-rows').replaceChildren(...orders.map(manageRow));
      message('manage-status', ok || (orders.length ? '' : '暂无发货订单。'));
    } catch (error) {
      if (read !== manageRead || !manageDialog.open) return;
      $('manage-rows').replaceChildren();
      message('manage-status', error.message, true);
    }
  }

  async function manageOrder(operation, data, trigger) {
    if (adminBusy) return;
    adminBusy = true;
    trigger.disabled = true;
    message('manage-status', '正在处理…');
    try {
      await api('/admin/shop/orders/' + operation.id + '/' + operation.action, data);
      resetManageForm();
      await Promise.all([loadOrders(), loadManage({ claim: '已认领，请到上游商城采购。', deliver: '已发货。', refund: '已退回 BotGo 余额。' }[operation.action])]);
    } catch (error) {
      message('manage-status', error.message, true);
    } finally {
      adminBusy = false;
      trigger.disabled = false;
    }
  }

  $('manage-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!adminAction) return;
    const data = adminAction.action === 'refund' ? { confirmed: true }
      : { code: $('supplier-card').value, supplierOrder: $('supplier-order').value };
    manageOrder(adminAction, data, $('manage-submit'));
  });
  $('manage-cancel').addEventListener('click', resetManageForm);
  $('manage-orders').addEventListener('click', () => {
    manageDialog.showModal();
    loadManage();
  });
  $('manage-refresh').addEventListener('click', () => loadManage());
  manageDialog.addEventListener('close', () => {
    manageRead++;
    resetManageForm();
    $('manage-rows').replaceChildren();
  });

  for (const dialog of document.querySelectorAll('.shop-dialog')) {
    dialog.querySelector('.shop-dialog-head').prepend(brandMark.cloneNode(true));
    for (const button of dialog.querySelectorAll('[data-close]')) {
      button.addEventListener('click', () => dialog.close());
    }
  }
  for (const trigger of document.querySelectorAll('[data-shop-policy]')) {
    trigger.addEventListener('click', () => openPolicy());
  }
  $('catalog-retry').addEventListener('click', loadCatalog);
  $('open-orders').addEventListener('click', openOrders);
  $('refresh-orders').addEventListener('click', loadOrders);
  $('checkout-orders').addEventListener('click', () => {
    checkoutDialog.close();
    openOrders();
  });
  checkoutDialog.addEventListener('close', () => { checkout = null; });
  $('card-form').addEventListener('submit', event => {
    event.preventDefault();
    readCard($('card-code').value.trim());
  });
  $('card-code').addEventListener('input', () => {
    stopCheck();
    checkedCode = '';
    message('card-status', '');
  });
  document.querySelector('.shop-portal').addEventListener('click', () => { leftForPortal = true; });
  $('copy-code').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('delivery-code').textContent);
      message('delivery-status', '已复制。');
    } catch {
      message('delivery-status', '请选中卡密后手动复制。', true);
    }
  });
  $('use-code').addEventListener('click', () => {
    const code = $('delivery-code').textContent;
    $('delivery-dialog').close();
    ordersDialog.close();
    $('card-code').value = code;
    $('card-code').focus();
    readCard(code);
  });
  $('delivery-dialog').addEventListener('close', () => { $('delivery-code').textContent = ''; });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (checkout) checkout.needsFunds = false;
    loadOrders();
    if (leftForPortal && checkedCode && checkedCode === $('card-code').value.trim()) readCard(checkedCode);
    leftForPortal = false;
  });
  window.addEventListener('storage', event => {
    if (event.key !== 'botgo-web-logout') return;
    stopCheck();
    cardRead++;
    wallet = null;
    walletStatus = 'guest';
    if ($('delivery-dialog').open) $('delivery-dialog').close();
    if (manageDialog.open) manageDialog.close();
    if (ordersDialog.open) ordersDialog.close();
    $('card-form').reset();
    checkedCode = '';
    message('card-status', '');
    renderOrders();
    loadOrders();
  });
  loadCatalog();
  loadOrders();
})();
