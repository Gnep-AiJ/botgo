const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { verifyPackagedRuntime } = require('../scripts/verify-packaged-runtime.cjs');
test('packaging gate detects omitted binary, damaged files, and non-runnable or wrong-version runtime', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'botgo-package-'));
  const sourceRoot = path.join(root, 'source'), resources = path.join(root, 'resources');
  const binary = 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe';
  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
  try {
    write(path.join(sourceRoot, binary), 'fixture binary');
    write(path.join(sourceRoot, 'lib/native.cjs'), 'fixture shared library');
    write(path.join(sourceRoot, 'node_modules/@openai/codex-win32-x64/package.json'), '{"version":"0.154.0-win32-x64"}');
    write(path.join(resources, 'agent/lib/native.cjs'), 'fixture shared library');
    const options = { sourceRoot, exec: async () => ({ stdout: 'codex-cli 0.154.0\n' }) };
    await assert.rejects(verifyPackagedRuntime(resources, options), /运行环境不完整/);
    fs.cpSync(sourceRoot, path.join(resources, 'agent'), { recursive: true });
    assert.equal((await verifyPackagedRuntime(resources, options)).verified, true);
    await assert.rejects(verifyPackagedRuntime(resources, { ...options, exec: async () => { throw Error('cannot execute'); } }), /cannot execute/);
    await assert.rejects(verifyPackagedRuntime(resources, { ...options, exec: async () => ({ stdout: 'codex-cli 0.100.0' }) }), /version/);
    write(path.join(resources, 'agent', binary), 'damaged');
    await assert.rejects(verifyPackagedRuntime(resources, options), /missing or changed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
