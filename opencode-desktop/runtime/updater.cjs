const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { finished } = require('node:stream/promises');
const { once } = require('node:events');

const MAX_INSTALLER_SIZE = 1024 ** 3;
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/;

function parseVersion(value) {
  const match = VERSION.exec(String(value));
  if (!match) throw Error('Unsupported update version');
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] === undefined ? Number.MAX_SAFE_INTEGER : Number(match[4])];
}

function newer(candidate, installed) {
  const a = parseVersion(candidate), b = parseVersion(installed);
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] > b[index];
  return false;
}

function validateRelease(release, currentVersion, origin) {
  if (!release || !newer(release.version, currentVersion)) return null;
  if (!/^[a-f0-9]{64}$/i.test(release.sha256 || '')) throw Error('Update checksum is invalid');
  if (!Number.isSafeInteger(release.size_bytes) || release.size_bytes <= 0 || release.size_bytes > MAX_INSTALLER_SIZE) throw Error('Update size is invalid');
  const expectedOrigin = new URL(origin);
  const downloadUrl = new URL(release.downloadUrl, expectedOrigin);
  if (expectedOrigin.protocol !== 'https:' || downloadUrl.protocol !== 'https:' || downloadUrl.origin !== expectedOrigin.origin) throw Error('Update download location is invalid');
  return { ...release, sha256: release.sha256.toLowerCase(), downloadUrl: downloadUrl.toString() };
}

async function sha256(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function createUpdater({ currentVersion, origin, directory, deviceToken, fetchImpl = fetch, verifySignature, launch, stop = async () => {}, onLog = (_message, _data) => {} }) {
  if (!VERSION.test(String(currentVersion))) throw Error('Unsupported current version');
  let state = { status: 'idle' };
  let pending;
  let ready;
  let controller;
  const listeners = new Set();
  const transition = next => {
    state = next;
    onLog('updater state changed', { status: next.status, version: next.version });
    for (const listener of listeners) listener(state);
    return state;
  };
  const token = () => {
    const value = deviceToken();
    if (typeof value !== 'string' || !/^bgdt_[A-Za-z0-9_-]+$/.test(value)) throw Error('Sign in is required before checking for updates');
    return value;
  };
  const requestRelease = async () => {
    const response = await fetchImpl(new URL('/api/desktop/releases/current', origin), {
      redirect: 'error',
      headers: { authorization: `Bearer ${token()}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
    });
    if (!response.ok) throw Error(`Update check failed (${response.status})`);
    const payload = await response.json();
    return validateRelease(payload?.release, currentVersion, origin);
  };
  const download = async release => {
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, `${release.sha256}.exe`);
    const partial = `${file}.part`;
    if (fs.existsSync(file) && await sha256(file) === release.sha256) {
      await verifySignature(file);
      return file;
    }
    let output;
    try {
      const response = await fetchImpl(release.downloadUrl, {
        redirect: 'error',
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60 * 1000)]),
      });
      if (!response.ok || !response.body) throw Error('Update download failed');
      output = fs.createWriteStream(partial, { flags: 'w' });
      const hash = crypto.createHash('sha256');
      let received = 0;
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        received += bytes.length;
        if (received > release.size_bytes) throw Error('Update size does not match');
        hash.update(bytes);
        if (!output.write(bytes)) await once(output, 'drain');
        transition({ status: 'downloading', version: release.version, received, total: release.size_bytes });
      }
      output.end();
      await finished(output);
      if (received !== release.size_bytes || hash.digest('hex') !== release.sha256) throw Error('Update checksum does not match');
      await verifySignature(partial);
      if (fs.existsSync(file)) fs.unlinkSync(file);
      fs.renameSync(partial, file);
      return file;
    } catch (error) {
      if (output && !output.closed) {
        output.destroy();
        await once(output, 'close').catch(() => undefined);
      }
      throw error;
    } finally {
      if (fs.existsSync(partial)) fs.unlinkSync(partial);
    }
  };
  const check = () => {
    if (pending) return pending;
    pending = (async () => {
      controller = new AbortController();
      transition({ status: 'checking' });
      const release = await requestRelease();
      if (!release) {
        ready = undefined;
        return transition({ status: 'up-to-date' });
      }
      const file = await download(release);
      ready = { release, file };
      return transition({ status: 'ready', version: release.version });
    })().catch(error => transition({ status: 'error', message: error instanceof Error ? error.message : 'Update failed' })).finally(() => {
      controller = undefined;
      pending = undefined;
    });
    return pending;
  };
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    start: check,
    check,
    cancel() { controller?.abort(); },
    async install() {
      if (!ready || state.status !== 'ready') throw Error('No verified update is ready');
      transition({ status: 'installing', version: ready.release.version });
      try {
        controller = new AbortController();
        const current = await requestRelease();
        if (!current || current.sha256 !== ready.release.sha256 || current.version !== ready.release.version) throw Error('The available update changed; check again');
        if (await sha256(ready.file) !== ready.release.sha256) throw Error('The verified installer changed; check again');
        await verifySignature(ready.file);
        await stop();
        await launch(ready.file);
      } catch (error) {
        transition({ status: 'ready', version: ready.release.version });
        throw error;
      } finally {
        controller = undefined;
      }
    },
  };
}

module.exports = { createUpdater, newer, parseVersion, validateRelease, sha256 };
