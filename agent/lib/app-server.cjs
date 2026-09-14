const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createConnection } = require('./app-server-connection.cjs');
const { safeMessage } = require('./codex-runner.cjs');
const modes = { 'read-only': 'read-only', 'workspace-write': 'workspace-write', 'full-access': 'danger-full-access' };
function createAppServerRunner(settings = {}) {
  let connection, connecting, active, sandboxReady;
  const loaded = new Set(), completedTurns = new Set();
  const notify = event => settings.onEvent?.(event);
  async function connect(options) {
    if (connecting) return connecting;
    if (connection && !connection.closed) return;
    const current = createConnection({ ...settings, ...options,
      onMessage(message) {
        if (message.method === 'windowsSandbox/setupCompleted') { sandboxReady?.(message.params); return; }
        if (active) active.receive(message);
        else if (message.id !== undefined) current.send({ id: message.id, error: { code: -32601, message: 'No active task' } });
        else notify({ type: 'runtime-notification', operation: message.method,
          message: message.method === 'mcpServer/oauthLogin/completed' ? `${message.params?.name || 'MCP'}：${message.params?.success ? '授权完成' : '授权失败或取消'}` : undefined });
      },
      onClose(message) { loaded.clear(); active?.fail(message); notify({ type: 'connection-closed', message }); }
    });
    connection = current;
    connecting = (async () => {
      await current.rpc('initialize', { clientInfo: { name: 'botgo_desktop', title: 'BotGo Desktop', version: '1.2.1-preview.9' }, capabilities: { experimentalApi: true } });
      current.send({ method: 'initialized' });
    })();
    try { await connecting; } catch (error) { current.close(error.message); throw error; }
    finally { connecting = null; }
  }
  const service = {
    connect,
    get connected() { return Boolean(connection && !connection.closed); },
    close() { connection?.close(); },
    // Main-process callers only. Never expose this method across preload.
    async request(method, params) {
      if (!service.connected) throw Error('本地环境尚未连接。');
      if (connecting) await connecting;
      const result = await connection.rpc(method, params);
      if (['thread/archive', 'thread/unarchive'].includes(method)) loaded.delete(params.threadId);
      return result;
    },
    start(options) {
      if (active) throw Error('已有任务正在执行。');
      const { projectPath, model, prompt, permission, sessionId, id, onEvent = () => {} } = options;
      if (!modes[permission] || (permission === 'full-access' && !options.confirmedFullAccess)) throw Error('权限模式未确认。');
      if (!path.isAbsolute(projectPath) || !fs.statSync(projectPath).isDirectory()) throw Error('工作文件夹不可用，请重新选择。');
      if (typeof prompt !== 'string' || !prompt.trim()) throw Error('请输入任务。');
      if (options.reviewer && !['auto_review', 'user'].includes(options.reviewer)) throw Error('审核或授权参数无效。');
      let threadId = '', turnId = '', settled = false, stopped = false, stopTimer;
      let resolveDone;
      const promise = new Promise(resolve => { resolveDone = resolve; });
      const requests = new Map(), items = new Map(), childThreads = new Set();
      const requestPrefix = randomUUID();
      const emit = event => {
        try { onEvent({ ...event, threadId: id, turnId, projectPath }); }
        catch { connection?.close('本地事件或历史保存失败，连接已停止。'); }
      };
      const send = message => connection.send(message);
      const rpc = (method, params) => connection.rpc(method, params);
      function finish(type, message) {
        if (settled) return;
        settled = true; clearTimeout(stopTimer); requests.clear();
        if (turnId) completedTurns.add(turnId);
        active = null;
        emit({ type: 'requests-cleared' });
        emit({ type, message: safeMessage(message || '') });
        resolveDone({ type, sessionId: threadId });
      }
    function receive(message) {
      if (settled) return;
      const p = message.params || {}, method = message.method;
      if (completedTurns.has(p.turnId || p.turn?.id)) return;

      if (message.id !== undefined) {
        const supported = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput', 'mcpServer/elicitation/request'];
        if (!supported.includes(method) || p.threadId !== threadId || (turnId && p.turnId && p.turnId !== turnId) || stopped) {
          send({ id: message.id, error: { code: -32601, message: 'Unsupported or inactive request' } }); return;
        }
        turnId ||= p.turnId || '';
        if (method === 'mcpServer/elicitation/request' && !['form', 'url'].includes(p.mode)) {
          send({ id: message.id, result: { action: 'cancel' } });
          emit({ type: 'activity', message: '此 MCP 授权类型需要外部账户验证，当前客户端不支持。' }); return;
        }
        const requestId = `${requestPrefix}:${message.id}`;
        requests.set(requestId, { id: message.id, method, params: p });
        emit({ type: 'request', requestId, operation: method, kind: method === 'mcpServer/elicitation/request' ? 'elicitation' : method.endsWith('requestUserInput') ? 'question' : 'approval',
          message: safeMessage(p.message || p.reason || p.command || '此操作需要你的确认。'),
          details: safeMessage(JSON.stringify(p.permissions || p.commandActions || p.grantRoot || items.get(p.itemId) || p)),
          questions: p.questions || [], schema: p.requestedSchema, url: p.mode === 'url' ? p.url : undefined, allow: permission !== 'read-only' });
        return;
      }
      if (!threadId && p.threadId) return;
      if (p.threadId && p.threadId !== threadId) {
        if (childThreads.has(p.threadId) && ['item/started', 'item/completed', 'thread/status/changed'].includes(method)) emit({ type: 'activity', message: '子代理进度', details: safeMessage(JSON.stringify(p)) });
        return;
      }
      if (p.turnId && turnId && p.turnId !== turnId) return;
      if (p.turn?.id && turnId && p.turn.id !== turnId) return;
      if (/autoApprovalReview|guardianWarning/.test(method)) emit({ type: 'review', operation: method, details: safeMessage(JSON.stringify(p)) });
      if (method === 'guardianWarning') emit({ type: 'activity', message: '自动审核出现警告。请查看审核详情；需要确认时使用下方原生审批卡片。任务不会自动重发。' });
      if (method === 'turn/plan/updated') emit({ type: 'plan', turnId: p.turnId || turnId, plan: p.plan, explanation: safeMessage(p.explanation || '') });
      if (method === 'turn/diff/updated') emit({ type: 'diff', diff: safeMessage(p.diff) });
      if (method === 'item/mcpToolCall/progress') emit({ type: 'activity', message: safeMessage(p.message || 'MCP 正在处理…') });
      if (method === 'item/started' && /mcpToolCall|collabAgent|plan|review/i.test(p.item?.type || '')) emit({ type: 'activity', message: p.item.type, details: safeMessage(JSON.stringify(p.item)) });
      if (method === 'turn/started') turnId = p.turn.id;
      if (method === 'item/agentMessage/delta') emit({ type: 'delta', itemId: p.itemId, delta: safeMessage(p.delta) });
      if (method === 'item/started' && p.item) items.set(p.item.id, p.item);
      if (p.item?.type === 'collabAgentToolCall') {
        for (const id of p.item.receiverThreadIds || []) childThreads.add(id);
        emit({ type: 'activity', message: `子代理：${p.item.tool} · ${p.item.status}`, details: safeMessage(JSON.stringify(p.item.agentsStates)) });
      }
      if (method === 'item/started' && p.item?.type === 'commandExecution') emit({ type: 'activity', message: '正在执行命令', details: safeMessage(p.item.command) });
      if (method === 'item/completed') {
        if (p.item?.type === 'agentMessage') emit({ type: 'progress', itemId: p.item.id, message: safeMessage(p.item.text) });
        if (p.item?.type === 'fileChange') emit({ type: 'files', files: (p.item.changes || []).map(change => change.path) });
      }
      if (method === 'serverRequest/resolved') { const requestId = `${requestPrefix}:${p.requestId}`; requests.delete(requestId); emit({ type: 'request-resolved', requestId }); }
      if (method === 'turn/completed') finish(stopped || p.turn.status === 'interrupted' ? 'stopped' : p.turn.status === 'completed' ? 'completed' : 'error', p.turn.error?.message);
      if (method === 'error' && !p.willRetry) finish('error', p.error?.message || '任务未能完成。');
    }
      const taskState = { receive, fail: message => finish(stopped ? 'stopped' : 'error', message) };
      active = taskState;
      Promise.resolve().then(async () => {
        if (settled || stopped) return;
        emit({ type: 'started' });
        await connect(options);
        options.relayKey = undefined;
        if (settled || stopped) return;
        if (process.platform === 'win32' && permission !== 'full-access') {
          const readiness = await rpc('windowsSandbox/readiness', {});
          if (readiness.status !== 'ready') {
            emit({ type: 'activity', message: '正在准备本地权限保护…' });
            let timeout;
            const prepared = new Promise((resolve, reject) => {
              sandboxReady = result => result.success ? resolve() : reject(Error(result.error || '权限保护初始化失败或超时。'));
              timeout = setTimeout(() => reject(Error('权限保护初始化失败或超时。')), settings.requestTimeout || 30000);
            });
            await Promise.all([rpc('windowsSandbox/setupStart', { mode: 'unelevated', cwd: projectPath }), prepared])
              .finally(() => { clearTimeout(timeout); sandboxReady = null; });
          }
        }
        if (settled || stopped) return;
        const reviewer = permission === 'read-only' ? 'user' : options.reviewer || 'user';
        const params = { cwd: projectPath, model, modelProvider: 'botgo', sandbox: modes[permission],
          approvalPolicy: permission === 'read-only' ? 'never' : 'on-request', approvalsReviewer: reviewer };
        if (sessionId && loaded.has(sessionId) && !options.review) threadId = sessionId;
        else {
          const result = await rpc(sessionId ? 'thread/resume' : 'thread/start', { ...params, ...(sessionId ? { threadId: sessionId } : {}) });
          threadId = result.thread.id; loaded.add(threadId);
        }
        emit({ type: 'session', sessionId: threadId });
        if (settled || stopped) return;
        const sandboxPolicy = permission === 'workspace-write'
          ? { type: 'workspaceWrite', writableRoots: [projectPath], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true }
          : { type: permission === 'read-only' ? 'readOnly' : 'dangerFullAccess' };
        const input = [{ type: 'text', text: prompt }, ...(options.input || [])];
        const started = options.review
          ? await rpc('review/start', { threadId, delivery: 'inline', target: { type: 'uncommittedChanges' } })
          : await rpc('turn/start', { threadId, input, cwd: projectPath, model, sandboxPolicy,
            approvalPolicy: params.approvalPolicy, approvalsReviewer: reviewer,
            collaborationMode: { mode: options.plan ? 'plan' : 'default', settings: { model, developer_instructions: null } } });
        if (!settled) turnId = started.turn.id;
      }).catch(error => {
        if (!settled) { finish(stopped ? 'stopped' : 'error', error.message); connection?.close(); }
      });
      return { promise,
        requestUrl(requestId) {
          const request = requests.get(String(requestId));
          if (settled || stopped || request?.params.mode !== 'url') throw Error('授权请求已失效。');
          const url = new URL(request.params.url);
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('审核或授权参数无效。');
          return url.toString();
        },
        async steer(text) {
          if (settled || stopped || !turnId || typeof text !== 'string' || !text.trim()) throw Error('当前任务无法接收补充指令。');
          const result = await rpc('turn/steer', { threadId, expectedTurnId: turnId, input: [{ type: 'text', text }] });
          emit({ type: 'steered', message: text }); return result;
        },
        stop() {
          if (settled || stopped) return;
          stopped = true; requests.clear(); emit({ type: 'requests-cleared' });
          if (!turnId) { connection?.close(); finish('stopped'); return; }
          rpc('turn/interrupt', { threadId, turnId }).catch(() => connection.close());
          stopTimer = setTimeout(() => connection.close('停止响应超时，原生进程已关闭。'), 5000);
        },
      respond({ requestId, decision, answers, content } = {}) {
        const request = requests.get(String(requestId));
        if (settled || stopped || !request) throw Error('此请求已失效。');
        let result;
        if (request.method === 'mcpServer/elicitation/request') {
          if (!['accept', 'decline', 'cancel'].includes(decision)) throw Error('无效的回答。');
          if (decision === 'accept' && request.params.mode === 'form') require('./elicitation.cjs').validateForm(request.params.requestedSchema, content);
          result = { action: decision, ...(decision === 'accept' && request.params.mode === 'form' ? { content } : {}) };
        } else if (request.method.endsWith('requestUserInput')) {
          if (!answers || typeof answers !== 'object') throw Error('请填写答案。');
          const clean = {};
          for (const q of request.params.questions) {
            const values = answers[q.id]?.answers;
            if (!Array.isArray(values) || !values.length || values.some(v => typeof v !== 'string' || v.length > 10000)) throw Error('请填写所有问题。');
            clean[q.id] = { answers: values };
          }
          result = { answers: clean };
        } else {
          if (!['accept', 'decline'].includes(decision) || (decision === 'accept' && permission === 'read-only')) throw Error('无效的授权选择。');
          result = request.method === 'item/permissions/requestApproval'
            ? { permissions: decision === 'accept' ? request.params.permissions : {}, scope: 'turn' } : { decision };
        }
        send({ id: request.id, result }); requests.delete(String(requestId)); emit({ type: 'request-resolved', requestId: String(requestId) });
        return { ok: true };
      }
      };
    }
  };
  return service;
}
module.exports = { createAppServerRunner };
