const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const version = '1.3.1';
const releaseDir = path.join(root, 'artifacts', 'releases', `client-${version}`);
const installer = path.join(releaseDir, `BotGo-${version}-win-x64.exe`);
const prepare = fs.readFileSync(path.join(root, 'opencode-desktop', 'prepare.mjs'), 'utf8');
const packageConfig = fs.readFileSync(path.join(root, 'opencode-desktop', 'installer.cjs'), 'utf8');
const signatureVerifier = fs.readFileSync(path.join(root, 'opencode-desktop', 'runtime', 'verify-signature.ps1'), 'utf8');

if (!fs.existsSync(installer)) throw Error(`Missing native release candidate: ${installer}`);
const sha256 = crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex');
const result = {
  client: { version, file: path.basename(installer), sizeBytes: fs.statSync(installer).size, sha256 },
  checks: {
    botgoIdentity: /pkg\.name='@botgo\/desktop'/.test(prepare),
    managedUpdater: /UPDATER_ENABLED = true/.test(prepare),
    signedInstaller: /104C109C454B26C3B5028EE66D8B225F447F953F/.test(signatureVerifier),
    exactArtifactName: /BotGo-\$\{version\}-win-x64/.test(packageConfig),
  },
};
result.ok = Object.values(result.checks).every(Boolean) && result.client.sizeBytes > 0;
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
