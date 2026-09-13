const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
function newer(candidate, installed) {
  const parse = value => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/.exec(value);
    if (!m) throw Error('无法识别更新版本。');
    return [+m[1], +m[2], +m[3], m[4] === undefined ? Number.MAX_SAFE_INTEGER : +m[4]];
  };
  const a = parse(candidate), b = parse(installed);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
async function sha256(file) { const hash = crypto.createHash('sha256'); for await (const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
function createUpdater({ directory, version, origin, currentRelease, fetchImpl = fetch, verifySignature, onState = () => {} }) {
  let running, ready, controller;
  const update = state => { onState(state); return state; };
  const validate = release => {
    if (!release || !newer(release.version, version)) return false;
    if (!/^[a-f0-9]{64}$/i.test(release.sha256) || !Number.isSafeInteger(release.size_bytes) || release.size_bytes <= 0 || release.size_bytes > 1024 ** 3) throw Error('更新信息校验失败。');
    const url = new URL(release.downloadUrl, origin);
    if (url.origin !== new URL(origin).origin || url.protocol !== 'https:') throw Error('更新地址不可信。');
    return url;
  };
  async function check() {
    if (running) return running;
    running = (async () => {
      update({ state: 'checking' });
      const release = await currentRelease(), url = validate(release);
      if (!url) { ready = null; return update({ state: 'current', version }); }
      fs.mkdirSync(directory, { recursive: true });
      const file = path.join(directory, release.sha256.toLowerCase() + '.exe'), partial = file + '.part';
      if (!fs.existsSync(file) || await sha256(file) !== release.sha256.toLowerCase()) {
        controller = new AbortController(); let received = 0, last = 0;
        const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60 * 1000)]) });
        if (!response.ok || !response.body) throw Error('更新下载失败，请重试。');
        const guard = new Transform({ transform(chunk, _, callback) {
          received += chunk.length;
          if (received > release.size_bytes) return callback(Error('安装包大小不符。'));
          if (Date.now() - last > 250) { last = Date.now(); update({ state: 'downloading', version: release.version, received, total: release.size_bytes }); }
          callback(null, chunk);
        } });
        try {
          await pipeline(Readable.fromWeb(response.body), guard, fs.createWriteStream(partial, { flags: 'w' }));
          if (received !== release.size_bytes || await sha256(partial) !== release.sha256.toLowerCase()) throw Error('安装包校验失败，当前版本保持不变。');
          await verifySignature(partial); fs.renameSync(partial, file);
        } finally { if (fs.existsSync(partial)) fs.unlinkSync(partial); controller = null; }
      }
      await verifySignature(file); ready = { file, release };
      return update({ state: 'ready', version: release.version });
    })().catch(error => update({ state: 'error', message: error.message })).finally(() => { running = null; });
    return running;
  }
  return { check, cancel() { controller?.abort(); }, async installer() {
    if (!ready) throw Error('请先下载并校验更新。');
    const current = await currentRelease();
    if (!validate(current) || current.sha256 !== ready.release.sha256) throw Error('线上版本已变化，请重新检查更新。');
    if (await sha256(ready.file) !== ready.release.sha256.toLowerCase()) throw Error('安装包已变化，请重新下载。');
    await verifySignature(ready.file); return ready.file;
  } };
}
module.exports = { createUpdater, newer, sha256 };
