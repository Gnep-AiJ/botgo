const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const releaseDir = path.join(root, 'artifacts', 'releases', `client-${version}`);
const installer = path.join(releaseDir, `BotGo-${version}-win-x64.exe`);
const prepare = fs.readFileSync(path.join(root, 'opencode-desktop', 'prepare.mjs'), 'utf8');
const packageConfig = fs.readFileSync(path.join(root, 'opencode-desktop', 'installer.cjs'), 'utf8');
const signatureVerifier = fs.readFileSync(path.join(root, 'opencode-desktop', 'runtime', 'verify-signature.ps1'), 'utf8');
const {spawnSync}=require('node:child_process');
const asar=require('../artifacts/opencode/node_modules/@electron/asar');
const archive=path.join(releaseDir,'win-unpacked/resources/app.asar');
const packagedVerifier=path.join(releaseDir,'win-unpacked/resources/botgo/verify-signature.ps1');
if(!fs.existsSync(packagedVerifier)||fs.readFileSync(packagedVerifier,'utf8')!==signatureVerifier)throw Error('Packaged update verifier is missing or differs');
const manifest=JSON.parse(asar.extractFile(archive,'package.json').toString());
if(manifest.version!==version)throw Error('Packaged version mismatch');

if (!fs.existsSync(installer)) throw Error(`Missing native release candidate: ${installer}`);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
const result = {
  client: { version, file: path.basename(installer), sizeBytes: fs.statSync(installer).size, sha256 },
  checks: {
    botgoIdentity: /pkg\.name='@botgo\/desktop'/.test(prepare),
    managedUpdater: /UPDATER_ENABLED = true/.test(prepare),
    signedInstaller: spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',packagedVerifier,'-FilePath',installer],{windowsHide:true,stdio:'pipe'}).status===0,
    packagedVerifier: true,
    exactArtifactName: /BotGo-\$\{version\}-win-x64/.test(packageConfig),
  },
};
result.ok = Object.values(result.checks).every(Boolean) && result.client.sizeBytes > 0;
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
