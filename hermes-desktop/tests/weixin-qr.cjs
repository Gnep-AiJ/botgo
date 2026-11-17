// Live QR issuance only: never scan, bind an account, or send a message.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const resources = path.join(root, 'artifacts/releases/hermes-preview-simple/win-unpacked/resources');
const payload = path.join(resources, 'hermes-payload');
const runtime = JSON.parse(fs.readFileSync(path.join(payload, 'runtime.json'), 'utf8'));
const home = path.join(root, 'artifacts/verification/hermes-acceptance/qr-issuance');
fs.mkdirSync(home, { recursive: true });
const qq=process.argv.includes('--qq');
const child = spawn(path.join(payload, runtime.python), [path.join(resources, qq?'botgo/qq-login.py':'botgo/weixin-login.py')], {
  cwd: path.join(payload, 'hermes-agent'), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, HERMES_HOME: home, HERMES_RUNTIME_DIR: path.join(payload, 'tools'),
    PYTHONPATH: [path.join(payload, 'hermes-agent'), path.join(payload, 'venv/Lib/site-packages')].join(path.delimiter), PYTHONNOUSERSITE: '1' },
});
let buffer = '', complete = false;
function finish(passed, reason) {
  if (complete) return; complete = true; clearTimeout(timer); child.kill();
  fs.writeFileSync(path.join(home, qq?'qq-result.json':'result.json'), JSON.stringify({ passed, reason, bound: false, messagesSent: 0 }, null, 2));
  console.log(passed ? `Packaged native ${qq?'QQ Bot':'Weixin'} QR issuance passed; no account bound` : 'Messaging QR issuance not verified: ' + reason);
  process.exitCode = passed ? 0 : 1;
}
child.stdout.setEncoding('utf8');
child.stdout.on('data', value => {
  buffer += value;
  let i; while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    try {
      const event = JSON.parse(line);
      if (event.event === 'qr') {
        const url = new URL(event.url);
        finish(url.protocol === 'https:' && (qq?url.hostname==='q.qq.com':/(^|\.)weixin\.qq\.com$/.test(url.hostname)), 'native_qr_response');
      } else if (event.event === 'error') finish(false, event.code || 'native_error');
    } catch { finish(false, 'invalid_response'); }
  }
});
child.once('error', () => finish(false, 'spawn_failed'));
child.once('exit', () => { if (!complete) finish(false, 'exited_without_qr'); });
const timer = setTimeout(() => finish(false, 'timeout'), 60000);
