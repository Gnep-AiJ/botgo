const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { nativeCommand } = require('../../agent/lib/native.cjs');

async function hash(file) {
  const digest = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function verifyPackagedRuntime(resources, { sourceRoot = path.resolve(__dirname, '../../agent'), exec = promisify(execFile) } = {}) {
  const packagedRoot = path.join(resources, 'agent');
  const command = nativeCommand(packagedRoot); // Missing binaries must fail the build.
  const sourceBinaryRoot = path.join(sourceRoot, 'node_modules/@openai/codex-win32-x64');
  for (const relative of ['lib', 'node_modules/@openai/codex-win32-x64']) {
    const source = path.join(sourceRoot, relative);
    for (const entry of fs.readdirSync(source, { recursive: true })) {
      const original = path.join(source, entry);
      if (!fs.statSync(original).isFile()) continue;
      const target = path.join(packagedRoot, relative, entry);
      if (!fs.existsSync(target) || await hash(original) !== await hash(target)) throw Error(`Packaged runtime missing or changed: ${relative}/${entry}`);
    }
  }
  const version = JSON.parse(fs.readFileSync(path.join(sourceBinaryRoot, 'package.json'), 'utf8')).version.replace(/-win32-x64$/, '');
  const { stdout } = await exec(command, ['--version'], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
  if (stdout.trim() !== `codex-cli ${version}`) throw Error('Packaged Codex version did not match the pinned runtime');
  return { command, version, verified: true };
}

module.exports = async context => {
  if (context.electronPlatformName !== 'win32') throw Error('BotGo runtime packaging currently supports Windows only');
  const result = await verifyPackagedRuntime(path.join(context.appOutDir, 'resources'));
  console.log(`Verified packaged Codex ${result.version}: all runtime files match and --version succeeded`);
};
module.exports.verifyPackagedRuntime = verifyPackagedRuntime;
