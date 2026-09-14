const { spawn } = require('node:child_process');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { runtimeEnvironment } = require('./native.cjs');
const { providerArguments } = require('./codex-config.cjs');
const { safeMessage } = require('./codex-runner.cjs');

// One transport owns one native process. A turn completing does not close it.
function createConnection({ command, projectPath, codexHome, relayKey, relayOrigin, model,
  spawnImpl = spawn, baseEnv = process.env, requestTimeout = 30000, onMessage, onClose }) {
  const child = spawnImpl(command, ['app-server', '--listen', 'stdio://', ...providerArguments(relayOrigin, model),
    '-c', `projects.${JSON.stringify(projectPath)}.trust_level="trusted"`], {
    cwd: projectPath, env: runtimeEnvironment(codexHome, relayKey, baseEnv), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
  });
  relayKey = undefined;
  let sequence = 0, closed = false, buffer = '';
  const decoder = new StringDecoder('utf8'), pending = new Map();
  function close(message = '连接已关闭，任务不会自动重发。') {
    if (closed) return;
    closed = true;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(Error(message)); }
    pending.clear();
    child.stdin.end();
    if (process.platform === 'win32' && child.pid) {
      const killer = spawnImpl(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => child.kill());
    } else child.kill();
    onClose?.(safeMessage(message));
  }
  function send(message) {
    if (closed) throw Error('原生连接已关闭。');
    child.stdin.write(JSON.stringify(message) + '\n');
  }
  function rpc(method, params = {}) {
    if (closed) return Promise.reject(Error('原生连接已关闭。'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // A timed out mutation has an unknown outcome. Never reuse or replay it.
        close(`${method} 响应超时；连接已停止，操作未重发。`);
      }, requestTimeout);
      pending.set(id, { resolve, reject, timer });
      try { send({ id, method, params }); } catch (error) { close(error.message); }
    });
  }
  child.stdout.on('data', chunk => {
    if (closed) return;
    buffer += decoder.write(chunk);
    if (buffer.length > 16 * 1024 * 1024) return close('原生事件超出大小限制。');
    const lines = buffer.split(/\r?\n/); buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim() || closed) continue;
      try {
        const message = JSON.parse(line);
        if (message.id !== undefined && !message.method) {
          const entry = pending.get(message.id); if (!entry) continue;
          pending.delete(message.id); clearTimeout(entry.timer);
          if (message.error) { const error = Error(safeMessage(message.error.message)); error.code = message.error.code; entry.reject(error); }
          else entry.resolve(message.result);
        } else onMessage?.(message);
      } catch (error) { close(error.message); }
    }
  });
  // Native stderr may contain third-party secrets. Do not forward it to the UI.
  child.stderr.on('data', () => {});
  child.stdin.on('error', () => close('原生连接写入失败，历史已保留。'));
  child.on('error', error => close(error.message));
  child.on('close', () => close('原生进程已退出，历史已保留。'));
  return { rpc, send, close, get closed() { return closed; } };
}
module.exports = { createConnection };
