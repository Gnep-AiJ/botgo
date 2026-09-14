const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const asar = require('../desktop/node_modules/@electron/asar');

const root = path.resolve(__dirname, '..');
const desktopVersion = require('../desktop/package.json').version;
const cliVersion = require('../agent/package.json').version;
const desktopDir = path.join(root, 'desktop', 'dist', desktopVersion);
const installer = path.join(desktopDir, `BotGo Desktop Setup ${desktopVersion}.exe`);
const archive = path.join(desktopDir, 'win-unpacked', 'resources', 'app.asar');
const cliArchive = path.join(root, 'agent', 'dist', `botgo-agent-${cliVersion}-win-x64.zip`);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fileHash = file => hash(fs.readFileSync(file));

for (const file of [installer, archive, cliArchive]) {
  if (!fs.existsSync(file)) throw new Error(`Missing release candidate: ${file}`);
}

const sourceFiles = [
  'main.cjs', 'preload.cjs', 'renderer.js', 'renderer-runtime.js',
  'renderer-settings.js', 'index.html', 'renderer.css', 'polish.css',
  ...fs.readdirSync(path.join(root, 'desktop', 'lib'))
    .filter(name => name.endsWith('.cjs')).map(name => `lib/${name}`)
];
const mismatches = sourceFiles.filter(file => {
  const source = fs.readFileSync(path.join(root, 'desktop', file));
  return hash(source) !== hash(asar.extractFile(archive, file));
});

const zipJson = entry => JSON.parse(execFileSync('tar', ['-xOf', cliArchive, entry], { encoding: 'utf8' }));
const packagedCli = zipJson('package.json');
const packagedCodex = zipJson('node_modules/@openai/codex/package.json');
const codexBinary = path.join(desktopDir, 'win-unpacked', 'resources', 'agent', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe');
const codexOutput = execFileSync(codexBinary, ['--version'], { encoding: 'utf8', windowsHide: true }).trim();
const result = {
  desktop: { version: desktopVersion, sizeBytes: fs.statSync(installer).size, sha256: fileHash(installer) },
  cli: { version: packagedCli.version, sizeBytes: fs.statSync(cliArchive).size, sha256: fileHash(cliArchive) },
  codex: { packageVersion: packagedCodex.version, binaryVersion: codexOutput },
  packagedSource: { checked: sourceFiles.length, mismatches },
  ok: packagedCli.version === cliVersion && packagedCodex.version === '0.154.0'
    && /0\.154\.0/.test(codexOutput) && mismatches.length === 0
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
