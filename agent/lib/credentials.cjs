const DEFAULT_SERVICE = "BotGo Agent";
const DEFAULT_ACCOUNT = "device-token";

function loadKeytar(explicit) {
  if (explicit) return explicit;
  try {
    return require("keytar");
  } catch (error) {
    const wrapped = new Error("Windows Credential Manager is unavailable. Install the agent dependencies and try again.");
    wrapped.cause = error;
    throw wrapped;
  }
}

function createCredentialStore({ keytarImpl, service = DEFAULT_SERVICE, account = DEFAULT_ACCOUNT } = {}) {
  const keytar = () => loadKeytar(keytarImpl);
  return {
    async load() {
      const raw = await keytar().getPassword(service, account);
      if (!raw) return null;
      try {
        const value = JSON.parse(raw);
        if (!value || typeof value.deviceToken !== "string" || !value.deviceToken.startsWith("bgdt_")) {
          throw new Error("Stored BotGo device credential is invalid");
        }
        return { deviceToken: value.deviceToken };
      } catch (error) {
        const wrapped = new Error("Stored BotGo device credential is invalid");
        wrapped.cause = error;
        throw wrapped;
      }
    },
    async save(value) {
      if (!value || typeof value.deviceToken !== "string" || !/^bgdt_[A-Za-z0-9_-]{1,256}$/.test(value.deviceToken)) {
        throw new Error("A valid BotGo device credential is required");
      }
      await keytar().setPassword(service, account, JSON.stringify({ deviceToken: value.deviceToken }));
    },
    async clear() {
      await keytar().deletePassword(service, account);
    }
  };
}

module.exports = { createCredentialStore, DEFAULT_SERVICE, DEFAULT_ACCOUNT };
