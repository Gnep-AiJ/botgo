const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { runtimeEnvironment } = require('./native.cjs');
const { providerArguments } = require('./codex-config.cjs');
const { safeMessage } = require('./codex-runner.cjs');

const modes = { 'read-only': 'read-only', 'workspace-write': 'workspace-write', 'full-access': 'danger-full-access' };
function createAppServerRunner({ command, spawnImpl = spawn, baseEnv = process.env, requestTimeout = 30000 } = {}) {
  let busy = false;
  return { start(options) {
    if (busy) throw Error('已有任务正在执行。');
    const { projectPath, codexHome, relayKey, relayOrigin, model, prompt, permission, sessionId, id, onEvent = () => {} } = options;
    if (!modes[permission] || (permission === 'full-access' && !options.confirmedFullAccess)) throw Error('权限模式未确认。');
    if (!path.isAbsolute(projectPath) || !fs.statSync(projectPath).isDirectory()) throw Error('工作文件夹不可用，请重新选择。');
    if (typeof prompt !== 'string' || !prompt.trim()) throw Error('请输入任务。');
    const env = runtimeEnvironment(codexHome, relayKey, baseEnv);
    const args = ['app-server', '--listen', 'stdio://', ...providerArguments(relayOrigin, model), '-c', `projects.${JSON.stringify(projectPath)}.trust_level="trusted"`];
    const child = spawnImpl(command, args, { cwd: projectPath, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    busy = true;
    let sequence = 0, threadId = '', turnId = '', settled = false, stopped = false, buffer = '', diagnostics = '', stopTimer, sandboxReady;
    const decoder = new StringDecoder('utf8'), waiting = new Map(), requests = new Map(), items = new Map();
    let resolveDone;
    const promise = new Promise(resolve => { resolveDone = resolve; });
    const emit = event => onEvent({ ...event, threadId: id, turnId, projectPath });
    const send = message => { if (!settled) child.stdin.write(JSON.stringify(message) + '\n'); };
    function terminate() {
      child.stdin.end();
      if (process.platform === 'win32' && child.pid) {
        const killer = spawnImpl(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else child.kill();
    }
    function finish(type, message) {
      if (settled) return;
      settled = true; busy = false; clearTimeout(stopTimer);
      for (const pending of waiting.values()) { clearTimeout(pending.timer); pending.reject(Error('连接已结束。')); }
      waiting.clear(); requests.clear();
      emit({ type: 'requests-cleared' }); emit({ type, message: safeMessage(message || '') });
      terminate(); resolveDone({ type, sessionId: threadId });
    }
    function rpc(method, params) {
      if (settled) return Promise.reject(Error('连接已结束。'));
      const requestId = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiting.delete(requestId); reject(Error('客户端响应超时，请重试。')); }, requestTimeout);
        waiting.set(requestId, { resolve, reject, timer });
        send({ id: requestId, method, params });
      });
    }
    function receive(message) {
      if (settled) return;
      if (message.id !== undefined && !message.method) {
        const pending = waiting.get(message.id); if (!pending) return;
        waiting.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(Error(safeMessage(message.error.message)));
        else pending.resolve(message.result);
        return;
      }
      const p = message.params || {}, method = message.method;
      if (method === 'windowsSandbox/setupCompleted') { sandboxReady?.(p); return; }
      if (message.id !== undefined) {
        const supported = ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval', 'item/permissions/requestApproval', 'item/tool/requestUserInput'];
        if (!supported.includes(method) || p.threadId !== threadId || (turnId && p.turnId !== turnId) || stopped) {
          send({ id: message.id, error: { code: -32601, message: 'Unsupported or inactive request' } }); return;
        }
        turnId ||= p.turnId;
        const requestId = String(message.id);
        requests.set(requestId, { id: message.id, method, params: p });
        emit({ type: 'request', requestId, operation: method, kind: method.endsWith('requestUserInput') ? 'question' : 'approval',
          message: safeMessage(p.reason || p.command || '此操作需要你的确认。'),
          details: safeMessage(JSON.stringify(p.permissions || p.commandActions || p.grantRoot || items.get(p.itemId) || p)),
          questions: p.questions || [], allow: permission !== 'read-only' });
        return;
      }
      if (p.threadId && threadId && p.threadId !== threadId) return;
      if (p.turnId && turnId && p.turnId !== turnId) return;
      if (p.turn?.id && turnId && p.turn.id !== turnId) return;
      if (method === 'turn/started') turnId = p.turn.id;
      if (method === 'item/agentMessage/delta') emit({ type: 'delta', itemId: p.itemId, delta: safeMessage(p.delta) });
      if (method === 'item/started' && p.item) items.set(p.item.id, p.item);
      if (method === 'item/started' && p.item?.type === 'commandExecution') emit({ type: 'activity', message: '正在执行命令', details: safeMessage(p.item.command) });
      if (method === 'item/completed') {
        if (p.item?.type === 'agentMessage') emit({ type: 'progress', itemId: p.item.id, message: safeMessage(p.item.text) });
        if (p.item?.type === 'fileChange') emit({ type: 'files', files: (p.item.changes || []).map(change => change.path) });
      }
      if (method === 'serverRequest/resolved') { requests.delete(String(p.requestId)); emit({ type: 'request-resolved', requestId: String(p.requestId) }); }
      if (method === 'turn/completed') finish(stopped || p.turn.status === 'interrupted' ? 'stopped' : p.turn.status === 'completed' ? 'completed' : 'error', p.turn.error?.message);
      if (method === 'error' && !p.willRetry) finish('error', p.error?.message || '任务未能完成。');
    }
    child.stdout.on('data', chunk => {
      buffer += decoder.write(chunk);
      if (buffer.length > 16 * 1024 * 1024) return finish('error', '运行事件过大，连接已停止。');
      const lines = buffer.split(/\r?\n/); buffer = lines.pop();
      for (const line of lines) { if (!line.trim()) continue; try { receive(JSON.parse(line)); } catch (error) { finish('error', error.message); } }
    });
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000); });
    child.stdin.on('error', error => finish(stopped ? 'stopped' : 'error', error.message));
    child.on('error', error => finish('error', error.message));
    child.on('close', () => finish(stopped ? 'stopped' : 'error', diagnostics || '本地运行进程已退出，历史已保留。'));
    // A process per turn renews the relay credential without replaying any turn;
    // the persisted native thread supplies continuity across turns and restarts.
    Promise.resolve().then(async () => {
      emit({ type: 'started' });
      await rpc('initialize', { clientInfo: { name: 'botgo_desktop', title: 'BotGo Desktop', version: '1.2.1-preview.4' }, capabilities: { experimentalApi: true } });
      send({ method: 'initialized' });
      if (process.platform === 'win32' && permission !== 'full-access') {
        const readiness = await rpc('windowsSandbox/readiness', {});
        if (readiness.status !== 'ready') {
          emit({ type: 'activity', message: '正在准备本地权限保护…' });
          let timeout;
          const prepared = new Promise((resolve, reject) => {
            sandboxReady = result => { clearTimeout(timeout); result.success ? resolve() : reject(Error(result.error || '本地权限保护未准备完成。')); };
            timeout = setTimeout(() => reject(Error('权限保护初始化超时，请重试。')), requestTimeout);
          });
          // Observe both promises immediately, including asynchronous setup failures.
          await Promise.all([rpc('windowsSandbox/setupStart', { mode: 'unelevated', cwd: projectPath }), prepared]).finally(() => { clearTimeout(timeout); sandboxReady = null; });
        }
      }
      const params = { cwd: projectPath, model, modelProvider: 'botgo', sandbox: modes[permission], approvalPolicy: permission === 'read-only' ? 'never' : 'on-request', approvalsReviewer: 'user' };
      const result = await rpc(sessionId ? 'thread/resume' : 'thread/start', { ...params, ...(sessionId ? { threadId: sessionId } : {}) });
      threadId = result.thread.id;
      emit({ type: 'session', sessionId: threadId });
      if (stopped) return finish('stopped');
      const sandboxPolicy = permission === 'workspace-write'
        ? { type: 'workspaceWrite', writableRoots: [projectPath], networkAccess: false, excludeTmpdirEnvVar: true, excludeSlashTmp: true }
        : { type: permission === 'read-only' ? 'readOnly' : 'dangerFullAccess' };
      const started = await rpc('turn/start', { threadId, input: [{ type: 'text', text: prompt }], cwd: projectPath, sandboxPolicy });
      turnId = started.turn.id;
    }).catch(error => { if (!settled) finish(stopped ? 'stopped' : 'error', error.message); });
    return { promise,
      stop() {
        if (settled || stopped) return;
        stopped = true; requests.clear(); emit({ type: 'requests-cleared' });
        if (!turnId) return finish('stopped');
        rpc('turn/interrupt', { threadId, turnId }).catch(() => finish('stopped'));
        stopTimer = setTimeout(() => finish('stopped'), 5000);
      },
      respond({ requestId, decision, answers } = {}) {
        const request = requests.get(String(requestId));
        if (settled || stopped || !request) throw Error('此请求已失效。');
        let result;
        if (request.method.endsWith('requestUserInput')) {
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
  } };
}
module.exports = { createAppServerRunner };
