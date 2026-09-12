const { build } = require('./package.json');
if (!/^[A-Fa-f0-9]{40}$/.test(process.env.BOTGO_PREVIEW_CERT_SHA1 || '')) throw Error('Pinned preview signing identity required');
module.exports = {
  ...build, forceCodeSigning: true,
  win: { ...build.win, signtoolOptions: { certificateSha1: process.env.BOTGO_PREVIEW_CERT_SHA1, signingHashAlgorithms: ['sha256'] } }
};
