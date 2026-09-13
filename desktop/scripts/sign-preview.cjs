const path = require('node:path');

module.exports = async (configuration, packager) => {
  // Preserve upstream runtime bytes; sign the BotGo application and installers.
  const file = path.resolve(configuration.path).replace(/\\/g, '/');
  if (file.includes('/resources/agent/node_modules/@openai/codex-win32-x64/')) return;
  const manager = await packager.signingManager.value;
  await manager.doSign(configuration, packager);
};
