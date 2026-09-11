const fs = require("node:fs");
const path = require("node:path");

function createCredentialStore({ filePath, safeStorage }) {
  function available() {
    if (!safeStorage?.isEncryptionAvailable()) throw new Error("Windows credential protection is unavailable");
  }
  return {
    load() {
      available();
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath)));
    },
    save(value) {
      available();
      if (!value || typeof value.deviceToken !== "string") throw new Error("A device credential is required");
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, safeStorage.encryptString(JSON.stringify({ deviceToken: value.deviceToken, desktopKey: value.desktopKey || null })));
    },
    clear() {
      if (fs.existsSync(filePath)) fs.rmSync(filePath);
    }
  };
}

module.exports = { createCredentialStore };
