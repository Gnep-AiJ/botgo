(() => {
  'use strict';
  const panel = document.getElementById('account-recharge');
  if (!panel) return;
  const find = selector => panel.querySelector(selector);
  const planSelect = find('#recharge-plan');
  const orderSelect = find('#recharge-order');
  const primary = find('[data-subscription-upgrade]');
  const secondary = find('#recharge-secondary');
  const payment = find('#recharge-payment');
  const qr = find('#recharge-qr');
  const openApp = find('#recharge-open-app');
  const status = find('#subscription-payment-status');
  const params = new URLSearchParams(location.search);
  const callbackId = params.get('opcpay_order');
  const localPreview = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) && params.get('preview') === 'account';
  const money = cents => '￥' + (cents / 100).toFixed(2);
  const path = '/api/billing/opcpay';

  let data = null;
  let selectedOrder = callbackId;
  let action = null;
  let busy = false;
  let epoch = 0;
  let showNew = false;
  let callbackChecked = false;
  let pollTimer = null;
  let pollCount = 0;
  let qrImage = null;

  function message(text = '', failed = false) {
    status.textContent = text;
    status.classList.toggle('is-error', failed);
    panel.dataset.opcpayError = String(failed);
  }

  function pending() {
    return (data?.orders || []).filter(order => !order.creditedAt && order.status !== 'REFUNDED');
  }

  function currentOrder() {
    if (showNew) return null;
    const orders = pending();
    return orders.find(order => order.id === selectedOrder) || orders.find(order => !order.purchaseExpired || order.status === 'PAID') || orders[0] || null;
  }

  function selectedPlan() {
    const plans = data?.plans || [];
    return plans.find(plan => plan.id === planSelect.value) || plans[0] || null;
  }

  function render() {
    const plan = selectedPlan();
    const plans = data?.plans || [];
    const order = currentOrder();
    const orders = pending();
    planSelect.replaceChildren(...plans.map(item => new Option(money(item.amountCents), item.id)));
    if (plan) planSelect.value = plan.id;
    planSelect.hidden = !!order || plans.length < 2;
    planSelect.disabled = busy;
    find('#recharge-order-history').hidden = orders.length < 2;
    orderSelect.replaceChildren(...orders.map(item => new Option(
      money(item.amountCents) + ' · ' + (item.status === 'PAID' ? '待入账' : '待确认') + ' · ' + item.id.slice(0, 8), item.id,
    )));
    if (order) orderSelect.value = order.id;
    orderSelect.disabled = busy;
    const amount = order?.amountCents ?? plan?.amountCents;
    find('#recharge-amount-label').textContent = amount ? money(amount) : '';
    find('#recharge-help').textContent = amount ? '支付宝确认付款后自动到账。' : '';
    payment.hidden = !order?.paymentUrl;
    if (order?.paymentUrl) {
      const source = qrImage?.id === order.id ? qrImage.source : path + orderPath(order.id, 'qr');
      if (qr.getAttribute('src') !== source) qr.src = source;
      openApp.href = order.paymentUrl;
    } else {
      qr.removeAttribute('src');
      openApp.removeAttribute('href');
    }
    primary.disabled = busy || localPreview;
    secondary.hidden = busy || !order?.purchaseExpired || order.status === 'PAID' || order.consumptionStarted;
    secondary.textContent = '发起新充值';
    if (busy) primary.textContent = '处理中…';
    else if (order) primary.textContent = !order.paymentUrl && !order.purchaseExpired && order.status !== 'PAID' && !order.consumptionStarted
      ? '加载付款二维码' : '查询到账状态';
    else primary.textContent = plan ? '支付宝充值' : '重试加载';
  }

  async function api(suffix, requestEpoch, body) {
    const response = await fetch(path + suffix, {
      credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(45_000),
      ...(body === undefined ? {} : {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }),
    });
    const value = await response.json().catch(() => ({}));
    if (epoch !== requestEpoch) throw new DOMException('Account changed', 'AbortError');
    if (value.order) {
      if (typeof value.qrImage === 'string' && /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/.test(value.qrImage)) {
        qrImage = { id: value.order.id, source: value.qrImage };
      }
      const orders = data?.orders || [];
      data = { ...data, orders: [value.order, ...orders.filter(item => item.id !== value.order.id)] };
      selectedOrder = value.order.id;
      showNew = false;
    }
    if (!response.ok) throw new Error(value.error || '充值暂未完成，请重试。');
    return value;
  }

  async function run(text, task) {
    if (busy) return;
    clearTimeout(pollTimer);
    busy = true;
    const requestEpoch = epoch;
    render();
    message(text);
    try {
      await task(requestEpoch);
    } catch (error) {
      if (epoch === requestEpoch) message(error.name === 'TimeoutError' || error instanceof TypeError
        ? '连接中断，请重试。' : error.message, true);
    } finally {
      if (epoch === requestEpoch) {
        busy = false;
        render();
      }
    }
  }

  const orderPath = (id, operation) => '/orders/' + encodeURIComponent(id) + '/' + operation;

  async function complete(id, requestEpoch) {
    const { order } = await api(orderPath(id, 'settle'), requestEpoch, {});
    if (order.status === 'REFUNDED') return message('该订单已退款。');
    if (order.creditedAt) {
      qrImage = null;
      showNew = true;
      window.dispatchEvent(new Event('botgo:account-refresh'));
      return message('已到账 ' + money(order.amountCents) + '。');
    }
    if (order.status === 'PAID' || order.consumptionStarted) {
      message('付款已确认，正在入账。');
    } else {
      message(order.purchaseExpired ? '付款链接已过期，仍可查询原订单。' : '正在等待支付宝确认付款。');
    }
    if (id === callbackId || order.paymentUrl || order.status === 'PAID') scheduleCheck(id, requestEpoch);
  }

  function scheduleCheck(id, requestEpoch) {
    if (pollCount >= 12) return;
    pollCount++;
    pollTimer = setTimeout(() => {
      if (!panel.hidden && panel.closest('dialog')?.open && epoch === requestEpoch && currentOrder()?.id === id) {
        run('正在查询到账状态…', currentEpoch => complete(id, currentEpoch));
      }
    }, 16_000);
  }

  async function load(requestEpoch) {
    data = await api('', requestEpoch);
    if (!callbackChecked && callbackId && data.orders.some(order => order.id === callbackId)) {
      callbackChecked = true;
      return complete(callbackId, requestEpoch);
    }
    const order = currentOrder();
    if (order?.status === 'PAID' || order?.consumptionStarted) return complete(order.id, requestEpoch);
    if (order?.paymentUrl) scheduleCheck(order.id, requestEpoch);
    if (currentOrder() || selectedPlan()) return message();
    if (data.catalogStatus === 'closed') return message('充值暂未开放。', true);
    message('暂时无法连接支付服务，请重试。', true);
  }

  function showPayment(order, requestEpoch) {
    if (!order.paymentUrl) {
      message(order.purchaseExpired ? '付款链接已过期，可发起新充值。' : '暂未取得付款链接，请重试。', true);
      return;
    }
    pollCount = 0;
    message();
    scheduleCheck(order.id, requestEpoch);
  }

  primary.addEventListener('click', () => {
    const order = currentOrder();
    if (order) {
      if (!order.paymentUrl && !order.purchaseExpired && order.status !== 'PAID' && !order.consumptionStarted) {
        run('正在加载付款二维码…', async requestEpoch => showPayment((await api(orderPath(order.id, 'resume'), requestEpoch, {})).order, requestEpoch));
      } else {
        run('正在查询到账状态…', requestEpoch => complete(order.id, requestEpoch));
      }
      return;
    }
    const plan = selectedPlan();
    if (!plan) {
      run('正在加载充值…', load);
      return;
    }
    if (!action || action.skuId !== plan.id) action = { skuId: plan.id, actionId: crypto.randomUUID() };
    run('正在加载付款二维码…', async requestEpoch => {
      const { order: created } = await api('/checkout', requestEpoch, action);
      action = null;
      showPayment(created, requestEpoch);
    });
  });
  secondary.addEventListener('click', () => {
    clearTimeout(pollTimer);
    showNew = true;
    action = null;
    message();
    render();
  });
  qr.addEventListener('error', () => {
    if (!payment.hidden) message('二维码暂时无法加载，可在本机打开支付宝。', true);
  });
  planSelect.addEventListener('change', render);
  orderSelect.addEventListener('change', () => {
    clearTimeout(pollTimer);
    pollCount = 0;
    selectedOrder = orderSelect.value;
    showNew = false;
    message();
    render();
    if (currentOrder()?.paymentUrl) scheduleCheck(selectedOrder, epoch);
  });
  window.addEventListener('botgo:logout', () => {
    clearTimeout(pollTimer);
    epoch++;
    data = action = qrImage = null;
    selectedOrder = callbackId;
    callbackChecked = busy = showNew = false;
    pollCount = 0;
    message();
    render();
  });
  window.addEventListener('botgo:recharge-open', () => {
    if (localPreview) {
      render();
      return message('本地界面预览。');
    }
    run('正在加载充值…', load);
  });
})();
