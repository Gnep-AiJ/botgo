const fs = require("node:fs");
const path = require("node:path");

function validateRelayUrl(relayUrl) {
  const url = new URL(relayUrl);
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("BotGo requires a deployed HTTPS relay URL");
  return url.origin;
}

function managedConfig(relayUrl) {
  return `model = "gpt-5.6"\nmodel_provider = "botgo"\n\n[model_providers.botgo]\nname = "BotGo Relay"\nbase_url = "${relayUrl}/api/v1"\nenv_key = "BOTGO_CODEX_API_KEY"\nwire_api = "responses"\nrequires_openai_auth = false\n`;
}

function prepareBotGoConfig({ configPath, backupDirectory, relayUrl, confirmed }) {
  const origin = validateRelayUrl(relayUrl);
  let backupPath = null;
  if (fs.existsSync(configPath)) {
    if (!confirmed) throw new Error("Replacing an existing Codex configuration requires confirmation");
    fs.mkdirSync(backupDirectory, { recursive: true });
    backupPath = path.join(backupDirectory, `codex-config-${Date.now()}.toml`);
    fs.copyFileSync(configPath, backupPath, fs.constants.COPYFILE_EXCL);
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.botgo-tmp`;
  fs.writeFileSync(temporaryPath, managedConfig(origin), "utf8");
  fs.renameSync(temporaryPath, configPath);
  return { backupPath };
}

function restoreOriginalConfig({ configPath, backupPath }) {
  if (!backupPath || !fs.existsSync(backupPath)) throw new Error("No saved Codex configuration is available to restore");
  const temporaryPath = `${configPath}.restore-tmp`;
  fs.copyFileSync(backupPath, temporaryPath);
  fs.renameSync(temporaryPath, configPath);
}

module.exports = { prepareBotGoConfig, restoreOriginalConfig };
