const sign = require('../opencode-desktop/sign.cjs');
module.exports = async function signBotGo(configuration, packager) {
  const file = configuration.path.replaceAll('\\', '/');
  // Retain pinned bytes and upstream signatures on the bundled runtimes.
  if (file.includes('/resources/hermes-payload/') || file.includes('/node_modules/')) return;
  return sign(configuration, packager);
};
