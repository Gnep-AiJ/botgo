const fs = require("node:fs");
const path = require("node:path");

const MANAGED_AUTH_MARKER = JSON.stringify({ auth_mode: "apikey", OPENAI_API_KEY: "botgo-managed-by-environment" });

function validateRelayOrigin(relayOrigin) {
  const url = new URL(relayOrigin);
  if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    throw new Error("BotGo Agent requires a deployed HTTPS relay URL");
  }
  return url.origin;
}

function managedConfig(relayOrigin) {
  const origin = validateRelayOrigin(relayOrigin);
  return [
    'model = "gpt-5.6-sol"',
    'model_provider = "botgo"',
    "",
    "[model_providers.botgo]",
    'name = "BotGo Relay"',
    `base_url = "${origin}/api/v1"`,
    'env_key = "BOTGO_CODEX_API_KEY"',
    'wire_api = "responses"',
    "requires_openai_auth = true",
    ""
  ].join("\n");
}

function writeCodexConfig({ codexHome, relayOrigin, fsImpl = fs }) {
  if (typeof codexHome !== "string" || !codexHome) throw new Error("An isolated CODEX_HOME is required");
  fsImpl.mkdirSync(codexHome, { recursive: true });
  const configPath = path.join(codexHome, "config.toml");
  const temporaryPath = `${configPath}.tmp-${process.pid}`;
  const authPath = path.join(codexHome, "auth.json");
  const authTemporaryPath = `${authPath}.tmp-${process.pid}`;
  const defaults = managedConfig(relayOrigin);
  // Codex only selects its provider-backed automatic reviewer in API-key auth
  // mode. This marker contains no credential; the short-lived relay key stays
  // exclusively in BOTGO_CODEX_API_KEY and takes precedence via env_key.
  if (!fsImpl.existsSync?.(authPath)) {
    fsImpl.writeFileSync(authTemporaryPath, MANAGED_AUTH_MARKER, "utf8");
    try { fsImpl.renameSync(authTemporaryPath, authPath); }
    catch {
      if (!fsImpl.existsSync?.(authPath)) fsImpl.writeFileSync(authPath, MANAGED_AUTH_MARKER, "utf8");
      if (typeof fsImpl.rmSync === "function") fsImpl.rmSync(authTemporaryPath, { force: true });
    }
  }
  // Existing BotGo settings (MCP, skills, permissions) belong to the user.
  // Keep them; managed provider values are supplied separately at invocation.
  if (fsImpl.existsSync?.(configPath)) return configPath;
  const serialized = defaults;
  fsImpl.writeFileSync(temporaryPath, serialized, "utf8");
  try {
    fsImpl.renameSync(temporaryPath, configPath);
  } catch (error) {
    // On Windows renameSync can fail when config.toml already exists.
    fsImpl.writeFileSync(configPath, serialized, "utf8");
    if (typeof fsImpl.rmSync === "function") fsImpl.rmSync(temporaryPath, { force: true });
    else if (typeof fsImpl.unlinkSync === "function") { try { fsImpl.unlinkSync(temporaryPath); } catch {} }
    void error;
  }
  return configPath;
}

function providerArguments(origin, model = 'gpt-5.6-sol') {
  const base = validateRelayOrigin(origin);
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(model)) throw new Error('Invalid model');
  return [
    '-c', `model="${model}"`, '-c', 'model_provider="botgo"',
    '-c', 'model_providers.botgo.name="BotGo Relay"',
    '-c', `model_providers.botgo.base_url="${base}/api/v1"`,
    '-c', 'model_providers.botgo.env_key="BOTGO_CODEX_API_KEY"',
    '-c', 'model_providers.botgo.wire_api="responses"',
    '-c', 'model_providers.botgo.requires_openai_auth=true'
  ];
}
module.exports = { managedConfig, writeCodexConfig, validateRelayOrigin, providerArguments };
