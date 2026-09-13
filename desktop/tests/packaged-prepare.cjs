// Runs the packaged main/preload through real IPC using a fresh, isolated profile.
// No credential fixture, no task execution, no writes to the user's app data.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const scriptIndex = process.argv.findIndex(arg => arg.endsWith('packaged-prepare.cjs'));
const resources = path.resolve(process.argv[scriptIndex + 1]);
const expectMissing = process.argv.includes('--expect-missing');
const out = path.resolve('.tmp-packaged-prepare', `${expectMissing ? 'old' : 'fixed'}-${Date.now()}`);
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(out, 'profile'));
app.disableHardwareAcceleration();
process.resourcesPath = resources;
const timeout = setTimeout(() => { console.error('Packaged prepare timed out'); app.exit(1); }, 30000);
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      assert.ok(window.webContents.getURL().includes('app.asar'));
      const result = await window.webContents.executeJavaScript("(async()=>{try{return {ok:true,result:await window.botgo.prepare(false)}}catch(error){return {ok:false,message:error.message}}})()", true);
      if (expectMissing) { assert.equal(result.ok, false); assert.match(result.message, /运行环境不完整/); }
      else { assert.equal(result.ok, true, result.message); assert.equal(result.result.ready, true); }
      const png = (await window.webContents.capturePage()).toPNG();
      if (png.length) fs.writeFileSync(path.join(out, 'window.png'), png);
      fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({ at: new Date().toISOString(), resources, expectMissing, result }, null, 2));
      console.log(JSON.stringify({ expectMissing, result, evidence: out })); clearTimeout(timeout);
      for (const win of BrowserWindow.getAllWindows()) win.destroy(); app.exit(0);
    } catch (error) { console.error(error); clearTimeout(timeout); app.exit(1); }
  });
});
require(path.join(resources, 'app.asar', 'main.cjs'));
