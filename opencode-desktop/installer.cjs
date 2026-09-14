const path = require('node:path');
const root = path.resolve(__dirname, '..');
if (!/^[A-Fa-f0-9]{40}$/.test(process.env.BOTGO_PREVIEW_CERT_SHA1 || '')) throw Error('Pinned preview signing identity required');
module.exports = {
  appId: 'com.botgo.desktop',
  productName: 'BotGo Desktop',
  artifactName: 'BotGo-${version}-win-x64.${ext}',
  directories: { output: path.join(root, 'artifacts/releases/client-1.3.0-preview.1'), buildResources: 'resources' },
  electronDist: path.join(root, 'artifacts/opencode/node_modules/electron/dist'),
  electronVersion: '42.3.3',
  npmRebuild: false,
  asar: true,
  files: ['out/**/*', '!out/**/*.map', 'resources/icons/icon.ico'],
  extraFiles: [{ from: path.join(root, 'artifacts/opencode/LICENSE'), to: 'LICENSE-engine.txt' }],
  extraResources: [{ from: 'resources/icons', to: 'icons' }],
  protocols: { name: 'BotGo', schemes: ['botgo'] },
  forceCodeSigning: true,
  win: {
    icon: 'resources/icons/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
    signtoolOptions: { certificateSha1: process.env.BOTGO_PREVIEW_CERT_SHA1, signingHashAlgorithms: ['sha256'], sign: path.join(__dirname, 'sign.cjs') },
  },
  nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true, deleteAppDataOnUninstall: false, shortcutName: 'BotGo Desktop' },
  publish: null,
};
