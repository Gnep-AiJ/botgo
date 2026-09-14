const path = require('node:path');
module.exports = async (configuration, packager) => {
  const file = path.resolve(configuration.path).replaceAll('\\', '/');
  // Third-party runtime binaries retain their original identity and bytes.
  if (file.includes('/node_modules/')) return;
  const manager = await packager.signingManager.value;
  await manager.doSign(configuration, packager);
};
