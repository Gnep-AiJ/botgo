const { app, safeStorage } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { createCredentialStore } = require('../lib/credential-store.cjs');
const { createAppServerRunner } = require('../../agent/lib/app-server.cjs');
const { nativeCommand } = require('../../agent/lib/native.cjs');
const out = path.resolve('artifacts/verification/app-server/live-' + Date.now());
fs.mkdirSync(path.join(out, 'project'), { recursive: true }); fs.mkdirSync(path.join(out, 'codex'), { recursive: true });
app.setPath('userData', path.join(out, 'electron-profile')); app.disableHardwareAcceleration();
// Chromium safeStorage also needs the original DPAPI-wrapped profile key.
// Copy only that encrypted field to the isolated test profile; never alter the user's profile.
const originalLocalState = path.join(process.env.APPDATA, 'botgo-desktop', 'Local State');
if (fs.existsSync(originalLocalState)) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(path.join(app.getPath('userData'), 'Local State'), JSON.stringify({ os_crypt: JSON.parse(fs.readFileSync(originalLocalState, 'utf8')).os_crypt }));
}
app.whenReady().then(async () => {
  const report = { kind: 'real BotGo relay; isolated project and native history', turns: [] };
  try {
    const current = createCredentialStore({ filePath: path.join(process.env.APPDATA, 'botgo-desktop', 'credentials.bin'), safeStorage }).load();
    if (!current?.deviceToken) throw Error('No existing Desktop login; user login required');
    const call = async (endpoint, method = 'GET') => { const response = await fetch('https://botgo.win/api' + endpoint, { method, headers: { authorization: 'Bearer ' + current.deviceToken }, signal: AbortSignal.timeout(20000) }); const result = await response.json(); if (!response.ok) throw Error(result.error || 'API failed'); return result; };
    report.before = (await call('/desktop/account')).account.balanceCents;
    let sessionId = '';
    for (const prompt of ['在当前工作目录创建 botgo-verification.txt，内容为 BOTGO_OK。不要访问其他目录；完成后只回答已完成。', '读取当前目录 botgo-verification.txt，回答它的内容，并说明上一轮做了什么。不要修改其他文件。']) {
      const issued = await call('/desktop/key', 'POST'); const events = [];
      const task = createAppServerRunner({ command: nativeCommand() }).start({ id: 'live', projectPath: path.join(out, 'project'), codexHome: path.join(out, 'codex'), relayKey: issued.key, relayOrigin: 'https://botgo.win', model: 'gpt-5.6-sol', permission: 'workspace-write', prompt, sessionId, onEvent: event => {
        events.push(event);
        fs.writeFileSync(path.join(out, 'events.json'), JSON.stringify(events, null, 2));
        // The test may approve only the one file explicitly requested in its prompt.
        if (event.operation === 'item/fileChange/requestApproval') {
          const item = JSON.parse(event.details);
          if (item.changes?.length === 1 && path.resolve(item.changes[0].path) === path.join(out, 'project', 'botgo-verification.txt')) {
            task.respond({ requestId: event.requestId, decision: 'accept' });
          }
        }
      } });
      const timer = setTimeout(() => task.stop(), 90000);
      const result = await task.promise; clearTimeout(timer); sessionId = result.sessionId;
      report.turns.push({ result, events });
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2));
      assert.equal(result.type, 'completed', 'Live task did not complete');
    }
    assert.match(fs.readFileSync(path.join(out, 'project', 'botgo-verification.txt'), 'utf8'), /BOTGO_OK/);
    report.after = (await call('/desktop/account')).account.balanceCents; report.status = 'passed';
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.log('PASS ' + out); app.exit(0);
  } catch (error) { report.status = 'failed'; report.error = error.message; fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); console.error(error.message + ' evidence: ' + out); app.exit(1); }
});
